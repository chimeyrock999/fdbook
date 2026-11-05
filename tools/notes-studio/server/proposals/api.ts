import type { ServerResponse } from 'node:http';
import { atLeast } from '../auth/shared.ts';
import { HttpError, pathnameOf, readJsonObject, sendJson, type Handler } from '../http.ts';
import { viewerOf, type Viewer } from '../security/access.ts';
import type { Thread } from '../review/shared.ts';
import type { DeleteProposals } from './deletes.ts';
import { PROPOSAL_OPS, type DeleteProposalView, type ProposalOp, type ProposalView } from './shared.ts';
import type { Proposals } from './store.ts';

const MAX_BODY_BYTES = 16 * 1024;
const HEARTBEAT_MS = 25_000;

// GET /api/proposals/events: each proposal as it is made or changes, each
// delete proposal as a `delete-proposal` event, and each review thread
// (review/threads.ts) as a `thread` event, to whoever may still read.
export function createProposalStream() {
  const streams = new Map<ServerResponse, Viewer>();
  let closed = false;
  const send = (frame: string) => {
    for (const [stream, viewer] of streams) {
      if (atLeast(viewer.current(), 'reader')) stream.write(frame);
      else {
        streams.delete(stream);
        stream.end();
      }
    }
  };
  const heartbeat = setInterval(() => { send(': heartbeat\n\n'); }, HEARTBEAT_MS);
  heartbeat.unref();
  return {
    send: (proposal: ProposalView) => { send(`data: ${JSON.stringify(proposal)}\n\n`); },
    sendDelete: (proposal: DeleteProposalView) => { send(`event: delete-proposal\ndata: ${JSON.stringify(proposal)}\n\n`); },
    sendThread: (thread: Thread) => { send(`event: thread\ndata: ${JSON.stringify(thread)}\n\n`); },
    subscribe(response: ServerResponse, viewer: Viewer) {
      if (closed) {
        sendJson(response, 409, { error: 'this change request is closing' });
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      response.write('retry: 1000\n\n');
      streams.set(response, viewer);
      response.on('close', () => streams.delete(response));
    },
    close() {
      closed = true;
      clearInterval(heartbeat);
      for (const stream of streams.keys()) stream.end();
      streams.clear();
    },
  };
}

export type ProposalStream = ReturnType<typeof createProposalStream>;
const NO_CR = 'Proposals live in a change request: open one first.';
const ONE = /^\/api\/proposals\/([a-z0-9-]+)$/;
const ONE_DELETE = /^\/api\/delete-proposals\/([a-z0-9-]+)$/;

// The proposals of one change request (store.ts, deletes.ts), or null
// where there are none (main):
// GET  /api/proposals[?path=…]   every proposal (of one note), oldest first
// GET  /api/proposals/<id>
// POST /api/proposals/<id> { op: accept | reject | rebase | drop, hunks? }
// GET  /api/proposals/events     server-sent events (createProposalStream)
// GET  /api/delete-proposals     every delete proposal (deletes.ts)
// POST /api/delete-proposals/<id> { op: accept | reject, base? }: accept
//                                deletes, with the base of the dry run shown
export function createProposalsApi(state: { proposals: Proposals; deletes: DeleteProposals; stream: ProposalStream } | null): Handler {
  async function answer(pathname: string, request: Parameters<Handler>[0]): Promise<unknown> {
    if (state === null) throw new HttpError(409, NO_CR);
    const path = new URL(request.url ?? '/', 'http://studio').searchParams.get('path') ?? undefined;
    if (pathname === '/api/proposals') {
      if (request.method !== 'GET') throw new HttpError(405, 'method not allowed');
      return { proposals: await state.proposals.list(path) };
    }
    if (pathname === '/api/delete-proposals') {
      if (request.method !== 'GET') throw new HttpError(405, 'method not allowed');
      return { proposals: await state.deletes.list() };
    }
    const deleteId = ONE_DELETE.exec(pathname)?.[1];
    if (deleteId !== undefined) {
      if (request.method === 'GET') return { proposal: await state.deletes.read(deleteId) };
      if (request.method !== 'POST') throw new HttpError(405, 'method not allowed');
      const { op, base } = await readJsonObject(request, MAX_BODY_BYTES, 'a decision');
      if (op !== 'accept' && op !== 'reject') throw new HttpError(400, 'op must be accept or reject');
      return { proposal: await state.deletes.act(deleteId, op, base) };
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
    if (pathname === '/api/proposals/events') {
      if (state === null) sendJson(response, 409, { error: NO_CR });
      else state.stream.subscribe(response, viewerOf(request));
      return true;
    }
    if (pathname !== '/api/proposals' && pathname !== '/api/delete-proposals' && !ONE.test(pathname) && !ONE_DELETE.test(pathname)) return false;
    try {
      sendJson(response, 200, await answer(pathname, request));
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
