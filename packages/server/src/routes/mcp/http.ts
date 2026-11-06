import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Auth } from '#services/auth/auth.ts';
import { atLeast } from '@fdbook/shared/auth.ts';
import type { ChangeRequests } from '#services/cr/manager.ts';
import type { StudioFiles } from '#services/files/studio-files.ts';
import { HttpError, pathnameOf, readBody, readJsonObject, sendJson, type Handler } from '#infra/http.ts';
import { NOTES_DIR } from '#infra/security/paths.ts';
import type { RunGrants } from '#services/agents/acp/grants.ts';
import type { Handoff } from './handoff.ts';
import type { StudioTool, ToolCaller, ToolResult } from './tool.ts';

// A request body holds one JSON-RPC message: a proposal carries a whole note.
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAIN = '_main';

const INSTRUCTIONS = `Tools of the Notes Studio, for the notes under ${NOTES_DIR} of one change request (CR).
- Every note tool takes \`cr\`, the change request's slug; an agent the Studio started has its CR already. Main is read only and refused: use list_crs, or create_cr for a new one.
- An agent the Studio started on main reads main with the tools that read, and edits nothing. When a change is needed it calls create_cr with a name and a brief: the Studio opens a change request and starts an author chat there with the brief; the answer has its slug and url.
- Edits go through propose_edit: they are not written, but shown to a person as suggestions to accept or reject. Read a note with read_note first.
- Review happens in threads on a note's blocks. A reviewer starts from cr_changes, reads the notes, and opens a thread per finding with add_comment (severity blocking or nit, a suggestion when it has the fix); it does not propose otherwise. An author answers each open thread (list_threads) with set_thread_state: addressed with the proposal that fixes it, or rejected with the reason.
- A message from the Studio may end with the context it adds: the note open in the editor, the lines selected there (edit those), mentioned files and attached documents.`;

// What the host needs of a change request's workspace (app/workspace.ts).
export type McpWorkspace = {
  root: string;
  // The worktree's files for `caller`: under its notes lock, and on its
  // run's Keep/Revert list when an agent run writes.
  files: (caller: ToolCaller) => StudioFiles;
};

export type McpHostOptions = {
  tools: StudioTool[];
  grants: RunGrants;
  auth: Pick<Auth, 'enabled' | 'viewerOfAgentToken' | 'issueAgentToken' | 'clearAgentTokens'>;
  crs: ChangeRequests | null;
  workspace: (slug: string) => Promise<McpWorkspace | null>;
  // create_cr for an agent on main (handoff.ts); null: it may not.
  handoff?: Handoff | null;
};

// The caller, and the change request it is held to (a run's own).
type Who = { caller: ToolCaller; slug: string | null };

class ToolError extends Error {}

const failed = (message: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text: message }] });

const resultOf = (result: ToolResult): CallToolResult => ({
  content: result.content,
  ...(result.structured === undefined ? {} : { structuredContent: result.structured }),
  ...(result.isError === undefined ? {} : { isError: result.isError }),
});

const CR_INPUT = { type: 'string', description: 'The change request\'s slug (list_crs). Not needed by an agent the Studio started.' };

function schemaOf(input: z.ZodType, cr: boolean): Tool['inputSchema'] {
  const schema: Tool['inputSchema'] & { $schema?: unknown } = { ...(z.toJSONSchema(input, { io: 'input' }) as Tool['inputSchema']) };
  delete schema.$schema;
  return cr ? { ...schema, type: 'object', properties: { ...(schema.properties ?? {}), cr: CR_INPUT } } : { ...schema, type: 'object' };
}

// May the caller use a tool of this access? 'write' changes the change
// request's files (a proposal included): no reviewer, no reader.
const mayUse = (caller: ToolCaller, access: StudioTool['access']) =>
  access === 'read' || (caller.kind === 'run' ? caller.role === 'author' : atLeast(caller.role, 'writer'));

// The Studio's MCP server at /api/mcp: Streamable HTTP, stateless (each
// request is answered on its own), for the agent runs the Studio starts
// and for a person's own agents in a terminal. Who calls comes from the
// bearer token: a run's (services/agents/acp/grants.ts), held to its change
// request and role, or with sign-in on, a person's agent token (POST
// /api/mcp/tokens), with their role. With sign-in off a request without one
// acts for the one person of this machine, like the rest of the API. Every
// note tool works in one change request and never on main; files go through
// the path policy.
// POST /api/mcp/tokens makes an agent token for the signed-in person,
// DELETE ends them all.
export function createMcpApi({ tools, grants, auth, crs, workspace, handoff = null }: McpHostOptions): Handler {
  async function whoIs(request: IncomingMessage): Promise<Who> {
    const header = request.headers.authorization ?? '';
    const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? null;
    if (token !== null) {
      const grant = grants.resolve(token);
      if (grant !== null) return { caller: { kind: 'run', runId: grant.runId, agent: grant.agent, role: grant.role }, slug: grant.slug };
      let viewer;
      try {
        viewer = await auth.viewerOfAgentToken(token);
      } catch (error) {
        throw new HttpError(503, `Could not read your access to the repository: ${(error as Error).message}`);
      }
      if (viewer === null) throw new HttpError(401, 'This token is not (or no longer) a Studio token.');
      if (!atLeast(viewer.role, 'reader')) throw new HttpError(403, `@${viewer.user?.login ?? '?'} has no access to this repository.`);
      return { caller: { kind: 'person', login: viewer.user?.login ?? null, role: viewer.role }, slug: null };
    }
    if (auth.enabled) throw new HttpError(401, 'Sign-in is on: send a Studio agent token (Authorization: Bearer …).');
    return { caller: { kind: 'person', login: null, role: 'admin' }, slug: null };
  }

  // An agent the Studio started on main: it reads main, and create_cr hands its work to a change request.
  const onMain = (who: Who) => who.caller.kind === 'run' && who.slug === MAIN;

  // The change request a call works in: the run's own, else the one named.
  // An agent on main works on main, which its role (a reviewer) keeps to reading.
  async function crOf(who: Who, given: unknown) {
    if (given !== undefined && typeof given !== 'string') throw new ToolError('cr must be a change request\'s slug');
    if (who.slug !== null && given !== undefined && given !== who.slug && !(onMain(who) && given === 'main')) throw new ToolError(`this agent works in ${who.slug === MAIN ? 'main' : `the change request ${who.slug}`} only`);
    const slug = who.slug ?? given;
    if (slug === undefined || slug === '') throw new ToolError('name the change request: cr (list_crs lists them; main is read only)');
    if ((slug === MAIN || slug === 'main') && !onMain(who)) throw new ToolError('main is read only: work in a change request (list_crs, create_cr)');
    const found = await workspace(slug);
    if (found === null) throw new ToolError(`no such change request: ${slug}`);
    return { slug, found };
  }

  const crTools = {
    list_crs: {
      description: 'Lists the change requests: slug, name, status and how many notes each changed.',
      input: z.object({}),
      write: false,
      async run() {
        if (crs === null) throw new ToolError('change requests are off in this Studio');
        const { crs: list } = await crs.list();
        return { crs: list.map((cr) => ({ slug: cr.slug, name: cr.name, status: cr.status, changedPages: cr.changedPages })) };
      },
    },
    create_cr: {
      description: 'Creates a change request (a branch with its own worktree) and answers its slug, for the note tools\' cr.',
      input: z.object({ name: z.string().min(1).max(80).describe('What the change is about, in a few words') }),
      write: true,
      async run(args: unknown) {
        if (crs === null) throw new ToolError('change requests are off in this Studio');
        const cr = await crs.create((args as { name: string }).name);
        return { slug: cr.slug, name: cr.name, branch: cr.branch };
      },
    },
  };

  // create_cr as an agent on main sees it: the brief goes with the work.
  const handoffTool = {
    description: 'Main is read only: when a change is needed, opens a change request and starts an author chat there with the same agent and your brief as its first message. Answers its slug, name, branch and url (where the person opens it). Once per message.',
    input: z.object({
      name: z.string().min(1).max(80).describe('What the change is about, in a few words'),
      brief: z.string().min(1).max(20_000).describe('What to change, in which notes and why: everything the author chat needs, as it remembers nothing of this one'),
    }),
  };

  function list(who: Who): Tool[] {
    const { caller } = who;
    // An agent the Studio started works in its own change request only;
    // one on main may hand its work to a new one.
    const own = caller.kind === 'run' ? [] : Object.entries(crTools).filter(([, tool]) => !tool.write || atLeast(caller.role, 'writer'));
    const handing = onMain(who) && handoff !== null ? [{ name: 'create_cr', description: handoffTool.description, inputSchema: schemaOf(handoffTool.input, false) }] : [];
    return [
      ...handing,
      ...own.map(([name, tool]) => ({ name, description: tool.description, inputSchema: schemaOf(tool.input, false) })),
      ...tools.filter((tool) => mayUse(who.caller, tool.access)).map((tool) => ({ name: tool.name, description: tool.description, inputSchema: schemaOf(tool.input, true) })),
    ];
  }

  async function call(who: Who, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult> {
    try {
      if (name === 'create_cr' && onMain(who) && handoff !== null && who.caller.kind === 'run') {
        const parsed = handoffTool.input.safeParse(args);
        if (!parsed.success) throw new ToolError(`invalid input: ${z.prettifyError(parsed.error)}`);
        const value = await handoff(who.caller.runId, parsed.data);
        return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
      }
      if (Object.hasOwn(crTools, name)) {
        const tool = crTools[name as keyof typeof crTools];
        if (who.caller.kind === 'run') throw new ToolError(`${name} is for a person's agent: an agent the Studio started works in its own change request`);
        if (tool.write && !atLeast(who.caller.role, 'writer')) throw new ToolError(`${name} needs write access`);
        const parsed = tool.input.safeParse(args);
        if (!parsed.success) throw new ToolError(`invalid input: ${z.prettifyError(parsed.error)}`);
        const value = await tool.run(parsed.data);
        return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
      }
      const tool = tools.find((candidate) => candidate.name === name);
      if (tool === undefined) throw new ToolError(`no such tool: ${name}`);
      if (!mayUse(who.caller, tool.access)) {
        if (onMain(who)) throw new ToolError(`${name} changes files and main is read only: call create_cr to carry the work on in a change request`);
        throw new ToolError(who.caller.kind === 'run' ? `${name} is for an author: a reviewer reads and comments` : `${name} needs write access`);
      }
      const { cr, ...rest } = args;
      const { slug, found } = await crOf(who, cr);
      const parsed = tool.input.safeParse(rest);
      if (!parsed.success) throw new ToolError(`invalid input: ${z.prettifyError(parsed.error)}`);
      return resultOf(await tool.run(parsed.data, { slug, root: found.root, caller: who.caller, files: found.files(who.caller), signal }));
    } catch (error) {
      return failed((error as Error).message);
    }
  }

  async function serve(request: IncomingMessage, response: ServerResponse) {
    // Stateless: no stream of server messages (GET) and no session to end
    // (DELETE), which the transport answers with 405 as the spec allows. A
    // GET stream would hold a connection open for as long as the client.
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      throw new HttpError(405, 'method not allowed: this MCP server answers POST only');
    }
    const who = await whoIs(request);
    let body: unknown;
    try {
      body = JSON.parse((await readBody(request, MAX_BODY_BYTES)).toString('utf8'));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, 'body is not JSON');
    }
    const controller = new AbortController();
    // The low-level server: the tools come with their own JSON schemas and
    // checks (registry above), not the SDK's zod wrapper.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const server = new Server({ name: 'notes-studio', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: list(who) }));
    server.setRequestHandler(CallToolRequestSchema, ({ params }) => call(who, params.name, params.arguments ?? {}, controller.signal));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    response.on('close', () => {
      controller.abort();
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  }

  async function tokens(request: IncomingMessage, response: ServerResponse) {
    if (request.method === 'POST') {
      await readJsonObject(request, 1024, 'a token request');
      sendJson(response, 200, { token: await auth.issueAgentToken(request) });
    } else if (request.method === 'DELETE') {
      await auth.clearAgentTokens(request);
      sendJson(response, 200, { ok: true });
    } else {
      response.setHeader('Allow', 'POST, DELETE');
      throw new HttpError(405, 'method not allowed');
    }
  }

  return async (request, response) => {
    const pathname = pathnameOf(request);
    if (pathname !== '/api/mcp' && pathname !== '/api/mcp/tokens') return false;
    try {
      if (pathname === '/api/mcp/tokens') await tokens(request, response);
      else await serve(request, response);
    } catch (error) {
      if (response.headersSent) response.end();
      else {
        if (error instanceof HttpError && error.status === 401) response.setHeader('WWW-Authenticate', 'Bearer realm="notes-studio"');
        sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
      }
    }
    return true;
  };
}
