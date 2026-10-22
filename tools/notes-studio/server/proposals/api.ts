import { HttpError, pathnameOf, readJsonObject, sendJson, type Handler } from '../http.ts';
import type { Comments } from './comments.ts';
import { PROPOSAL_OPS, type ProposalOp } from './shared.ts';
import type { Proposals } from './store.ts';

const MAX_BODY_BYTES = 16 * 1024;
const NO_CR = 'Proposals live in a change request: open one first.';
const ONE = /^\/api\/proposals\/([a-z0-9-]+)$/;

// The proposals and comments of one change request (store.ts, comments.ts),
// or null where there are none (main):
// GET  /api/proposals[?path=…]   every proposal (of one note), oldest first
// GET  /api/proposals/<id>
// POST /api/proposals/<id> { op: accept | reject | rebase | drop, hunks? }
// GET  /api/comments[?path=…]
export function createProposalsApi(state: { proposals: Proposals; comments: Comments } | null): Handler {
  async function answer(pathname: string, request: Parameters<Handler>[0]): Promise<unknown> {
    if (state === null) throw new HttpError(409, NO_CR);
    const path = new URL(request.url ?? '/', 'http://studio').searchParams.get('path') ?? undefined;
    if (pathname === '/api/comments' || pathname === '/api/proposals') {
      if (request.method !== 'GET') throw new HttpError(405, 'method not allowed');
      return pathname === '/api/comments' ? { comments: await state.comments.list(path) } : { proposals: await state.proposals.list(path) };
    }
    const id = ONE.exec(pathname)?.[1] ?? '';
    if (request.method === 'GET') return { proposal: await state.proposals.read(id) };
    if (request.method !== 'POST') throw new HttpError(405, 'method not allowed');
    const { op, hunks } = await readJsonObject(request, MAX_BODY_BYTES, 'a decision');
    if (!PROPOSAL_OPS.includes(op as ProposalOp)) throw new HttpError(400, `op must be one of ${PROPOSAL_OPS.join(', ')}`);
    if (hunks !== undefined && !(Array.isArray(hunks) && hunks.every((hunk) => typeof hunk === 'string'))) throw new HttpError(400, 'hunks must be a list of hunk ids');
    return { proposal: await state.proposals.act(id, op as ProposalOp, hunks) };
  }

  return async (request, response) => {
    const pathname = pathnameOf(request);
    if (pathname !== '/api/proposals' && pathname !== '/api/comments' && !ONE.test(pathname)) return false;
    try {
      sendJson(response, 200, await answer(pathname, request));
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
