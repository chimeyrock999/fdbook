import type { IncomingMessage, ServerResponse } from 'node:http';

// A request handler that answers the requests it owns and returns true, or
// returns false to pass the request on.
export type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

export async function readBody(request: IncomingMessage, limit: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function pathnameOf(request: IncomingMessage) {
  return new URL(request.url ?? '/', 'http://studio').pathname;
}

// Last in line: an /api/ path that no handler took. Without it Vite would
// answer with index.html, which a client cannot tell apart from data.
export const apiNotFound: Handler = (request, response) => {
  const pathname = pathnameOf(request);
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return Promise.resolve(false);
  sendJson(response, 404, { error: `no such Studio API: ${pathname}` });
  return Promise.resolve(true);
};
