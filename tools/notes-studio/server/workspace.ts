import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { createAgentConversationsApi } from './agents/api.ts';
import { createAgentConversations, type AgentConversationsOptions } from './agents/conversations.ts';
import { createAssetsApi } from './assets/api.ts';
import { createFilesApi } from './files/api.ts';
import { createFileEvents } from './files/events.ts';
import { createKeyedLock } from './files/store.ts';
import { createChangesApi } from './git/api.ts';
import { createPageHistoryApi } from './git/page-history-api.ts';
import { pathnameOf, sendJson, type Handler } from './http.ts';
import { createLintApi } from './lint/api.ts';
import { createPreviewApi } from './preview/api.ts';
import { createBuildReader, ghCheckRun } from './preview/check-runs.ts';
import type { PreviewOptions } from './preview/preview.ts';
import { createBranchPullRequestReader, ghPullRequest } from './preview/pull-request.ts';
import { refuseUpgrade } from './routing.ts';
import { createNotesSync } from './sync/notes-sync.ts';
import { createStudioFiles } from './files/studio-files.ts';
import type { ToolCaller } from './mcp/tool.ts';
import { createProposalsApi, createProposalStream, type ProposalStream } from './proposals/api.ts';
import { createComments, type Comments } from './proposals/comments.ts';
import { createProposals, type Proposals } from './proposals/store.ts';
import { createTreeApi } from './tree/api.ts';

// Methods that change nothing, and the one POST that writes nothing.
const READS = new Set(['GET', 'HEAD']);
const READ_ONLY_POSTS = new Set(['/api/lint']);

// Refuses every write to a read-only worktree (main), before a handler
// sees it: the UI hides the writes, this is what stops them.
const refuseWrites: Handler = (request, response) => {
  const pathname = pathnameOf(request);
  if (READS.has(request.method ?? 'GET') || READ_ONLY_POSTS.has(pathname) || !pathname.startsWith('/api/')) return Promise.resolve(false);
  sendJson(response, 403, { error: 'main is read only: edit in a change request' });
  return Promise.resolve(true);
};

// Without a server's own, a workspace reads builds and pull requests through
// gh and has no Pages project to name its preview after.
const defaultPreview = (): PreviewOptions => ({ builds: createBuildReader(ghCheckRun), pullRequests: createBranchPullRequestReader(ghPullRequest), pagesProject: null });

// What agent conversations need besides the worktree: its change request's
// slug, the profiles and where transcripts go (agents/conversations.ts); and
// the Studio home, where the change request's proposals and comments are kept.
export type WorkspaceAgents = Omit<AgentConversationsOptions, 'slug'> & { home: string };

// Where a change request's proposals and comments are kept, outside its worktree.
export const proposalsDirOf = (home: string, slug: string) => join(home, 'proposals', slug);
export const commentsFileOf = (home: string, slug: string) => join(home, 'comments', `${slug}.jsonl`);

// The handlers of one worktree: file API and events, lint, page tree,
// assets, changes (git status, commit, history), page history, preview (push, build, publish),
// agent conversations, and the notes sync socket. Agents work only with `agents`: in a
// change request, never on main.
export function createWorkspace(
  root: string,
  hosts: string[],
  { readOnly = false, preview = defaultPreview(), agents = null }: { readOnly?: boolean; preview?: PreviewOptions; agents?: (AgentConversationsOptions & { home: string }) | null } = {},
) {
  // Tree and asset changes both write notes: one at a time. A commit waits
  // for them too, so it never takes half of a rename. The lock is this
  // worktree's own: change requests never wait on each other.
  const notesLock = createKeyedLock();
  // Saves to one file, one at a time, from the editor and from agents alike.
  const pathLock = createKeyedLock();
  const fileEvents = createFileEvents(root);
  const sync = createNotesSync(root, hosts, { readOnly });
  // A change request's proposals and comments, and the stream of their changes.
  let review: { proposals: Proposals; comments: Comments; stream: ProposalStream } | null = null;
  const conversations = agents === null || readOnly
    ? null
    : createAgentConversations(root, {
      ...agents,
      lock: notesLock,
      pathLock,
      propose: ({ path, content, runId, agent, model }) => {
        if (review === null) return Promise.reject(new Error('no proposals here'));
        return review.proposals.propose({ path, content, by: { kind: 'run', runId, agent, model } });
      },
    });
  if (agents !== null && !readOnly) {
    const stream = createProposalStream();
    review = {
      stream,
      comments: createComments(commentsFileOf(agents.home, agents.slug), stream.sendComment),
      proposals: createProposals(root, {
        dir: proposalsDirOf(agents.home, agents.slug),
        notesLock,
        pathLock,
        onChange: (proposal, created) => {
          if (created && proposal.by.kind === 'run') conversations?.proposed(proposal.by.runId, proposal);
          stream.send(proposal);
        },
      }),
    };
  }
  const handlers: Handler[] = [
    ...(readOnly ? [refuseWrites] : []),
    fileEvents.handle,
    // A person's save is never reverted by a turn going on (agents/watch.ts).
    createFilesApi(root, pathLock, conversations === null ? undefined : (path) => { conversations.savedByPerson(path); }),
    createLintApi(root),
    createTreeApi(root, notesLock),
    createAssetsApi(root, notesLock),
    createChangesApi(root, notesLock),
    createPageHistoryApi(root, notesLock),
    createPreviewApi(root, preview, { readOnly, lock: notesLock }),
    createAgentConversationsApi(conversations),
    createProposalsApi(review),
  ];
  return {
    root,
    handlers,
    conversations,
    review,
    // The worktree's files for an MCP tool call (mcp/http.ts): under the
    // notes lock, and on the turn's Keep/Revert list when an agent writes
    // (a caller's `runId` is its conversation).
    files: (caller: ToolCaller) => createStudioFiles(root, {
      pathLock,
      notesLock,
      beforeWrite: caller.kind === 'run' && conversations !== null ? (path, previous) => { conversations.beforeWrite(caller.runId, path, previous); } : undefined,
      afterWrite: caller.kind === 'run' && conversations !== null ? (path, content) => conversations.wrote(caller.runId, path, content) : undefined,
    }),
    handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      sync.handleUpgrade(request, socket, head);
    },
    close: async () => {
      await conversations?.close();
      review?.stream.close();
      fileEvents.close();
      await sync.close();
    },
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;

const CR_PATH = /^\/cr\/([^/]+)(\/.*)$/;

// A change request's worktree is served under /cr/<slug>/: its API at
// /cr/<slug>/api/… and its notes sync at /cr/<slug>/__fde_sync, so a page
// open on one change request can only write to that one. Each workspace is
// opened on its first request (`resolve` finds the worktree) and kept until
// `close`. The request goes on with the prefix taken off, to the
// workspace's handlers, then to `shared` (what every workspace answers
// alike: icons, and the JSON 404 for any other /api/ path).
export function createWorkspaceRouter(hosts: string[], resolve: (slug: string) => Promise<string | null>, shared: Handler[], preview?: PreviewOptions, agents: WorkspaceAgents | null = null) {
  // `workspace` stays undefined while the entry opens.
  type Entry = { ready: Promise<Workspace | null>; workspace?: Workspace | null };
  const open = new Map<string, Entry>();

  const workspace = (slug: string) => {
    const existing = open.get(slug);
    if (existing) return existing.ready;
    const entry: Entry = { ready: Promise.resolve(null) };
    // A change request that does not exist (yet) is looked up again next
    // time; a later entry for the same slug is left alone.
    const drop = () => { if (open.get(slug) === entry) open.delete(slug); };
    entry.ready = resolve(slug).then(
      (root) => {
        entry.workspace = root === null ? null : createWorkspace(root, hosts, { preview, agents: agents === null ? null : { ...agents, slug } });
        if (entry.workspace === null) drop();
        return entry.workspace;
      },
      (error: unknown) => {
        drop();
        throw error;
      },
    );
    open.set(slug, entry);
    return entry.ready;
  };

  const handle: Handler = async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://studio');
    const match = CR_PATH.exec(url.pathname);
    if (!match) return false;
    const [, slug, rest] = match;
    if (rest !== '/api' && !rest.startsWith('/api/')) {
      sendJson(response, 404, { error: `no such Studio path: ${url.pathname}` });
      return true;
    }
    // Slugs are [a-z0-9-] (isCrSlug): anything escaped is no slug, so the path is not decoded.
    const found = await workspace(slug);
    if (found === null) {
      sendJson(response, 404, { error: `no such change request: ${slug}` });
      return true;
    }
    request.url = `${rest}${url.search}`;
    for (const handler of [...found.handlers, ...shared]) if (await handler(request, response)) return true;
    return false;
  };

  // Closes the workspace so a discard can remove its worktree. One still
  // opening is closed once it opens, not waited for: its lookup may be
  // queued behind the very discard that closes it.
  async function close(slug: string) {
    const entry = open.get(slug);
    open.delete(slug);
    if (entry === undefined) return;
    if (entry.workspace === undefined) {
      void entry.ready.then((found) => found?.close(), () => undefined);
      return;
    }
    await entry.workspace?.close();
  }

  return {
    handle,
    // A change request's workspace, opened if it is not yet; null when there is no such one.
    open: workspace,
    // A workspace already open, without opening it.
    peek: (slug: string) => open.get(slug)?.workspace ?? null,
    // The upgrade route for /cr/<slug>/__fde_sync.
    syncRoute: (endpoint: string) => ({
      matches: (request: IncomingMessage) => {
        const match = CR_PATH.exec(pathnameOf(request));
        return match !== null && match[2] === endpoint;
      },
      handle: (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        const slug = CR_PATH.exec(pathnameOf(request))?.[1] ?? '';
        workspace(slug).then(
          (found) => {
            if (found === null) refuseUpgrade(socket, 404);
            else found.handleUpgrade(request, socket, head);
          },
          () => { refuseUpgrade(socket, 404); },
        );
      },
    }),
    close,
    closeAll: () => Promise.all([...open.keys()].map(close)),
  };
}
