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

// A JSON object body. JSON only, so a browser must preflight the request
// and a foreign page cannot send one blind; `what` names it in the 415.
export async function readJsonObject(request: IncomingMessage, limit: number, what: string): Promise<Record<string, unknown>> {
  if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, `${what} must be application/json`);
  }
  let body: unknown;
  try {
    body = JSON.parse((await readBody(request, limit)).toString('utf8'));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'body is not JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'body must be an object');
  return body as Record<string, unknown>;
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
