import type { IncomingMessage } from 'node:http';
import { HttpError, pathnameOf, readJsonObject, sendJson, type Handler } from '../http.ts';
import type { ChangeRequests } from './manager.ts';

const MAX_BODY_BYTES = 16 * 1024;

// GET /api/crs: { enabled, crs, taken, prError } (`?fresh=1` reads the pull
// requests again). POST /api/crs with { name } creates one and answers
// { cr }. POST /api/crs/<slug>/discard with { dryRun? } answers what it
// removes (see manager.ts). Without change requests (a Studio over one
// worktree) the list is empty and `enabled` false.
export function createChangeRequestsApi(crs: ChangeRequests | null): Handler {
  async function route(request: IncomingMessage, pathname: string) {
    if (pathname === '/api/crs') {
      if (request.method === 'GET') {
        if (crs === null) return { enabled: false, crs: [], taken: [], prError: null };
        const fresh = new URL(request.url ?? '/', 'http://studio').searchParams.get('fresh') === '1';
        return { enabled: true, ...(await crs.list(fresh)) };
      }
      if (request.method !== 'POST') throw new HttpError(405, 'method not allowed');
      if (crs === null) throw new HttpError(404, 'change requests are off in this Studio');
      return { cr: await crs.create((await readJsonObject(request, MAX_BODY_BYTES, 'change request changes')).name) };
    }
    const slug = /^\/api\/crs\/([^/]+)\/discard$/.exec(pathname)?.[1];
    if (slug === undefined) throw new HttpError(404, `no such Studio API: ${pathname}`);
    if (request.method !== 'POST') throw new HttpError(405, 'method not allowed');
    if (crs === null) throw new HttpError(404, 'change requests are off in this Studio');
    return { discard: await crs.discard(slug, (await readJsonObject(request, MAX_BODY_BYTES, 'change request changes')).dryRun === true) };
  }

  return async (request, response) => {
    const pathname = pathnameOf(request);
    if (pathname !== '/api/crs' && !pathname.startsWith('/api/crs/')) return false;
    try {
      sendJson(response, 200, await route(request, pathname));
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
