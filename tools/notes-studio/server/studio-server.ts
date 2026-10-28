import { rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SYNC_ENDPOINT } from '@fumadocs-editor/core/sync';
import { createServer as createViteServer } from 'vite';
import { createAgentsInfoApi } from './agents/api.ts';
import { createAgentInfo, PROFILES, type AgentProfile } from './agents/profiles.ts';
import { createTranscripts } from './agents/transcripts.ts';
import { createAuth, type AuthOptions } from './auth/auth.ts';
import { DEFAULT_STUDIO_HOST, DEFAULT_STUDIO_PORT, repoRoot, studioRoot } from './config.ts';
import { createChangeRequestsApi } from './cr/api.ts';
import { openChangeRequests, type ChangeRequestOptions, type ChangeRequests } from './cr/manager.ts';
import { apiNotFound, HttpError, pathnameOf } from './http.ts';
import { createRunGrants } from './mcp/grants.ts';
import { createHandoff } from './mcp/handoff.ts';
import { createMcpApi } from './mcp/http.ts';
import { diagramTools } from './mcp/diagram-tools.ts';
import { writingTools } from './mcp/writing-tools.ts';
import { createNoteTools } from './mcp/note-tools.ts';
import type { StudioTool } from './mcp/tool.ts';
import { createIconsApi } from './icons/api.ts';
import { createBuildReader, ghCheckRun } from './preview/check-runs.ts';
import { createBranchPullRequestReader, ghPullRequest } from './preview/pull-request.ts';
import { createRequestListener, routeUpgrades } from './routing.ts';
import { ownHosts } from './security/guard.ts';
import { commentsFileOf, createWorkspace, createWorkspaceRouter, proposalsDirOf } from './workspace.ts';
export type StudioServer = {
  server: Server;
  url: string;
  close: () => Promise<void>;
};

function closeServer(server: Server) {
  return new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

// One process, one origin: the UI (Vite middleware), the file API, file
// events and the notes sync socket share <host>:<port>, behind one
// Host/Origin guard that runs on every request and every websocket upgrade.
// With `changeRequests` the Studio opens main read-only (unprefixed /api/…
// and /__fde_sync) and each change request's worktree under /cr/<slug>/
// (see workspace.ts). Without it, it edits the one worktree at `root`.
// With `auth`, everyone signs in with GitHub first and may do what their
// access to the repository allows (auth/auth.ts). Agents (`agents`, the
// Studio's profiles by default) run in change requests, and read only on
// main (agents/main-only.ts), their transcripts in the Studio home (agents/).
// Main's slug for its agents' transcripts and MCP tokens: no change request takes it.
const MAIN_SLUG = '_main';

export async function startStudioServer({ host = DEFAULT_STUDIO_HOST, port = DEFAULT_STUDIO_PORT, root = repoRoot, changeRequests, auth: authOptions = null, agents = PROFILES, tools = [] }: {
  host?: string;
  port?: number;
  root?: string;
  changeRequests?: ChangeRequestOptions;
  auth?: AuthOptions | null;
  agents?: AgentProfile[];
  // MCP tools mounted beside the note tools (mcp/tool.ts).
  tools?: StudioTool[];
} = {}): Promise<StudioServer> {
  const server = createServer();
  // Bind first so a busy port fails before Vite starts its watcher.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  // The address as bound, not as given: Node reports it canonically.
  const { address, port: boundPort } = server.address() as AddressInfo;
  const hosts = ownHosts(address, boundPort);
  const auth = createAuth(authOptions, boundPort, hosts[0]);

  let vite;
  try {
    vite = await createViteServer({
      root: studioRoot,
      appType: 'spa',
      server: { middlewareMode: true, port: boundPort, ws: { server } },
    });
  } catch (error) {
    await closeServer(server);
    throw error;
  }
  let crs: ChangeRequests | null = null;
  try {
    if (changeRequests) crs = await openChangeRequests(changeRequests);
  } catch (error) {
    await vite.close();
    await closeServer(server);
    throw error;
  }
  // One reader of each for every workspace, so their caches and push times are shared.
  const preview = {
    builds: changeRequests?.builds ?? createBuildReader(ghCheckRun),
    pullRequests: changeRequests?.branchPullRequests ?? createBranchPullRequestReader(ghPullRequest),
    pagesProject: changeRequests?.pagesProject ?? null,
  };
  const transcripts = changeRequests ? createTranscripts(changeRequests.home) : null;
  const shared = [createIconsApi(), createAgentsInfoApi(createAgentInfo(agents), transcripts), apiNotFound];
  // The Studio's MCP server (mcp/http.ts): each agent run gets a token for it.
  const grants = createRunGrants();
  const mcpUrl = `http://${hosts[0]}/api/mcp`;
  const workspaceAgents = transcripts && changeRequests ? { profiles: agents, transcripts, home: changeRequests.home, mcp: { url: mcpUrl, grants } } : null;
  // Main's agents run in a copy of it, made fresh before each turn.
  const main = createWorkspace(crs?.mainRoot ?? root, hosts, {
    readOnly: crs !== null,
    preview,
    agents: workspaceAgents === null ? null : { ...workspaceAgents, slug: MAIN_SLUG },
    mainAgents: crs === null ? null : { root: crs.mainAgentsRoot, prepare: crs.resetMainAgents },
  });
  const workspaces = createWorkspaceRouter(hosts, (slug) => crs?.worktreeOf(slug) ?? Promise.resolve(null), shared, preview, workspaceAgents);
  // A discarded change request's agents, watchers and sync close before its
  // worktree goes; its transcripts, proposals and comments go with it, so a
  // new one with the slug starts empty.
  crs?.onDiscard(async (slug) => {
    await workspaces.close(slug);
    await transcripts?.remove(slug);
    if (changeRequests) {
      await rm(proposalsDirOf(changeRequests.home, slug), { recursive: true, force: true });
      await rm(commentsFileOf(changeRequests.home, slug), { force: true });
    }
  });
  const reviewOf = async (slug: string) => {
    if (slug === MAIN_SLUG) throw new HttpError(409, 'main is read only: it has no suggestions or comments (create_cr opens a change request)');
    const review = (await workspaces.open(slug))?.review ?? null;
    if (review === null) throw new HttpError(404, `no such change request: ${slug}`);
    return review;
  };
  const mcp = createMcpApi({
    tools: createNoteTools({
      proposalsOf: async (slug) => (slug === MAIN_SLUG ? null : (await reviewOf(slug)).proposals),
      commentsOf: async (slug) => (await reviewOf(slug)).comments,
      // An MCP caller's `runId` is its conversation (agents/conversations.ts).
      modelOf: (slug, runId) => workspaces.peek(slug)?.conversations?.modelOf(runId) ?? null,
      createdBy: (slug, runId, path) => workspaces.peek(slug)?.conversations?.created(runId, path) ?? Promise.resolve(false),
      selectionOf: (slug, runId) => workspaces.peek(slug)?.conversations?.selection(runId) ?? null,
    }).concat(writingTools, diagramTools, tools),
    grants,
    auth,
    crs,
    workspace: async (slug) => (crs === null ? null : slug === MAIN_SLUG ? main : workspaces.open(slug)),
    handoff: crs === null || main.conversations === null ? null : createHandoff({
      crs,
      main: main.conversations,
      open: async (slug) => (await workspaces.open(slug))?.conversations ?? null,
      // The page opens a change request with ?cr= and a chat with ?chat= (src/api/workspace.ts).
      link: (slug, conversationId) => `http://${hosts[0]}/?cr=${slug}${conversationId === null ? '' : `&chat=${conversationId}`}`,
    }),
  });

  server.on('request', createRequestListener(hosts, [workspaces.handle, createChangeRequestsApi(crs), mcp, ...main.handlers, ...shared], vite.middlewares, auth));
  routeUpgrades(server, hosts, (viteHmr) => [
    {
      matches: (request) => pathnameOf(request) === SYNC_ENDPOINT,
      handle: main.handleUpgrade,
      needs: 'reader',
    },
    { ...workspaces.syncRoute(SYNC_ENDPOINT), needs: 'reader' },
    {
      // Vite only answers on its base path; elsewhere it would leave the socket open.
      matches: (request) =>
        pathnameOf(request) === '/' && ['vite-hmr', 'vite-ping'].includes(request.headers['sec-websocket-protocol'] ?? ''),
      handle: viteHmr,
    },
  ], auth);

  return {
    server,
    url: `http://${hosts[0]}/`,
    close: async () => {
      try {
        await workspaces.closeAll();
        await main.close();
        await vite.close();
      } finally {
        await closeServer(server);
      }
    },
  };
}
