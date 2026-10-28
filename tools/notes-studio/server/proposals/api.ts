import type { ServerResponse } from 'node:http';
import { atLeast } from '../auth/shared.ts';
import { HttpError, pathnameOf, readJsonObject, sendJson, type Handler } from '../http.ts';
import { viewerOf, type Viewer } from '../security/access.ts';
import type { Comments, NoteComment } from './comments.ts';
import { PROPOSAL_OPS, type ProposalOp, type ProposalView } from './shared.ts';
import type { Proposals } from './store.ts';

const MAX_BODY_BYTES = 16 * 1024;
const HEARTBEAT_MS = 25_000;

// GET /api/proposals/events: each proposal as it is made or changes, and
// each comment as a `comment` event, to whoever may still read.
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
    // A comment, as a `comment` event.
    sendComment: (comment: NoteComment) => { send(`event: comment\ndata: ${JSON.stringify(comment)}\n\n`); },
    sendCommentResolved: (id: string) => { send(`event: comment-resolved\ndata: ${JSON.stringify({ id })}\n\n`); },
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
const COMMENT = /^\/api\/comments\/([a-z0-9-]+)$/;

// The proposals and comments of one change request (store.ts, comments.ts),
// or null where there are none (main):
// GET  /api/proposals[?path=…]   every proposal (of one note), oldest first
// GET  /api/proposals/<id>
// POST /api/proposals/<id> { op: accept | reject | rebase | drop, hunks? }
// GET  /api/proposals/events     server-sent events (createProposalStream)
// GET  /api/comments[?path=…]
export function createProposalsApi(state: { proposals: Proposals; comments: Comments; stream: ProposalStream } | null): Handler {
  async function answer(pathname: string, request: Parameters<Handler>[0]): Promise<unknown> {
    if (state === null) throw new HttpError(409, NO_CR);
    const path = new URL(request.url ?? '/', 'http://studio').searchParams.get('path') ?? undefined;
    if (pathname === '/api/comments' || pathname === '/api/proposals') {
      if (request.method !== 'GET') throw new HttpError(405, 'method not allowed');
      return pathname === '/api/comments' ? { comments: await state.comments.list(path) } : { proposals: await state.proposals.list(path) };
    }
    const commentId = COMMENT.exec(pathname)?.[1];
    if (commentId !== undefined) {
      if (request.method !== 'DELETE') throw new HttpError(405, 'method not allowed');
      await state.comments.resolve(commentId);
      return { ok: true };
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
    if (pathname !== '/api/proposals' && pathname !== '/api/comments' && !ONE.test(pathname) && !COMMENT.test(pathname)) return false;
    try {
      sendJson(response, 200, await answer(pathname, request));
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
