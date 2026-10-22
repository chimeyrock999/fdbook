import { HttpError, pathnameOf, readJsonObject, sendJson, type Handler } from '../http.ts';
import { viewerOf } from '../security/access.ts';
import type { AgentRuns } from './runs.ts';
import type { AgentInfo } from './shared.ts';
import type { Transcripts } from './transcripts.ts';

const MAX_BODY_BYTES = 128 * 1024;
const NO_CR = 'Agents run in a change request: open one first.';

// GET /api/agents: the agents this Studio knows and whether each can run
// here. GET /api/agents/totals: the runs and cost of each change request
// (empty without change requests).
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

const RUN = /^\/api\/agents\/runs\/([a-z0-9-]+)(?:\/(cancel|permissions\/([a-f0-9]+)))?$/;

// The runs of one worktree (runs.ts), or null where agents may not run (main):
// GET  /api/agents/runs                         every run, newest first
// POST /api/agents/runs { agent, role, prompt } starts one
// GET  /api/agents/runs/<id>                    its summary and events
// POST /api/agents/runs/<id>/cancel {}
// POST /api/agents/runs/<id>/permissions/<ask> { optionId } (null rejects)
// GET  /api/agents/events                       server-sent events of every run
export function createAgentRunsApi(runs: AgentRuns | null): Handler {
  async function answer(pathname: string, request: Parameters<Handler>[0]): Promise<unknown> {
    if (runs === null) throw new HttpError(409, NO_CR);
    const by = viewerOf(request).user?.login ?? null;
    if (pathname === '/api/agents/runs') {
      if (request.method === 'GET') return { runs: await runs.list() };
      if (request.method !== 'POST') throw new HttpError(405, 'method not allowed');
      const body = await readJsonObject(request, MAX_BODY_BYTES, 'a run');
      return { run: runs.start({ agent: body.agent, role: body.role, prompt: body.prompt, by }) };
    }
    const match = RUN.exec(pathname);
    const id = match?.[1] ?? '';
    const action: string | undefined = match?.[2];
    if (action === undefined) {
      if (request.method !== 'GET') throw new HttpError(405, 'method not allowed');
      return runs.read(id);
    }
    if (request.method !== 'POST') throw new HttpError(405, 'method not allowed');
    const body = await readJsonObject(request, MAX_BODY_BYTES, action === 'cancel' ? 'a cancel' : 'an answer');
    if (action === 'cancel') runs.cancel(id);
    else runs.answer(id, match?.[3] ?? '', 'optionId' in body ? body.optionId : null, by);
    return { ok: true };
  }

  return async (request, response) => {
    const pathname = pathnameOf(request);
    if (pathname === '/api/agents/events') {
      if (runs === null) sendJson(response, 409, { error: NO_CR });
      else runs.subscribe(response, viewerOf(request));
      return true;
    }
    if (pathname !== '/api/agents/runs' && !RUN.test(pathname)) return false;
    try {
      sendJson(response, 200, await answer(pathname, request));
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
