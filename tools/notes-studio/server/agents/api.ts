import { HttpError, pathnameOf, readJsonObject, sendJson, type Handler } from '../http.ts';
import { viewerOf } from '../security/access.ts';
import type { AgentConversations } from './conversations.ts';
import type { AgentInfo } from './shared.ts';
import type { Transcripts } from './transcripts.ts';

const MAX_BODY_BYTES = 128 * 1024;
const NO_CR = 'Agents work in a change request: open one first.';

// GET /api/agents: the agents this Studio knows and whether each can run
// here. GET /api/agents/totals: the conversations and cost of each change
// request (empty without change requests).
export function createAgentsInfoApi(info: () => Promise<AgentInfo[]>, transcripts: Transcripts | null): Handler {
  return async (request, response) => {
    const pathname = pathnameOf(request);
    if (pathname !== '/api/agents' && pathname !== '/api/agents/totals') return false;
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendJson(response, 405, { error: 'method not allowed' });
      return true;
    }
    if (pathname === '/api/agents') sendJson(response, 200, { agents: await info() });
    else sendJson(response, 200, { totals: (await transcripts?.totals()) ?? {} });
    return true;
  };
}

const LIST = '/api/agents/conversations';
const ONE = /^\/api\/agents\/conversations\/([a-z0-9-]+)(?:\/(messages|cancel|permissions\/([a-f0-9]+)))?$/;

// The conversations of one worktree (conversations.ts), or null where
// agents may not work (main):
// GET    /api/agents/conversations                         every one, last active first
// POST   /api/agents/conversations { agent, role, prompt } starts one
// GET    /api/agents/conversations/<id>                    its summary and events
// DELETE /api/agents/conversations/<id>                    deletes it (not during a turn)
// POST   /api/agents/conversations/<id>/messages { prompt } its next turn
// POST   /api/agents/conversations/<id>/cancel {}          stops the turn going on
// POST   /api/agents/conversations/<id>/permissions/<ask> { optionId } (null rejects)
// GET    /api/agents/events                                server-sent events of every conversation
export function createAgentConversationsApi(conversations: AgentConversations | null): Handler {
  async function answer(pathname: string, request: Parameters<Handler>[0]): Promise<unknown> {
    if (conversations === null) throw new HttpError(409, NO_CR);
    const by = viewerOf(request).user?.login ?? null;
    if (pathname === LIST) {
      if (request.method === 'GET') return { conversations: await conversations.list() };
      if (request.method !== 'POST') throw new HttpError(405, 'method not allowed');
      const body = await readJsonObject(request, MAX_BODY_BYTES, 'a conversation');
      return { conversation: conversations.start({ agent: body.agent, role: body.role, prompt: body.prompt, by }) };
    }
    const match = ONE.exec(pathname);
    const id = match?.[1] ?? '';
    const action: string | undefined = match?.[2];
    if (action === undefined) {
      if (request.method === 'GET') return conversations.read(id);
      if (request.method !== 'DELETE') throw new HttpError(405, 'method not allowed');
      await conversations.remove(id);
      return { ok: true };
    }
    if (request.method !== 'POST') throw new HttpError(405, 'method not allowed');
    if (action === 'messages') {
      const body = await readJsonObject(request, MAX_BODY_BYTES, 'a message');
      return { conversation: await conversations.message(id, body.prompt, by) };
    }
    const body = await readJsonObject(request, MAX_BODY_BYTES, action === 'cancel' ? 'a cancel' : 'an answer');
    if (action === 'cancel') conversations.cancel(id);
    else conversations.answer(id, match?.[3] ?? '', 'optionId' in body ? body.optionId : null, by);
    return { ok: true };
  }

  return async (request, response) => {
    const pathname = pathnameOf(request);
    if (pathname === '/api/agents/events') {
      if (conversations === null) sendJson(response, 409, { error: NO_CR });
      else conversations.subscribe(response, viewerOf(request));
      return true;
    }
    if (pathname !== LIST && !ONE.test(pathname)) return false;
    try {
      sendJson(response, 200, await answer(pathname, request));
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
