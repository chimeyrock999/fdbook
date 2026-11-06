import type { IncomingMessage } from 'node:http';
import { atLeast } from '../auth/shared.ts';
import { HttpError, pathnameOf, readJsonObject, sendJson, type Handler } from '../http.ts';
import { viewerOf } from '../security/access.ts';
import type { ChangeRequests, DiscardSeen } from './manager.ts';

const MAX_BODY_BYTES = 16 * 1024;

// The dry run's answer about origin, sent back with a discard; anything else is none.
function seenOf(value: unknown): DiscardSeen | null {
  if (typeof value !== 'object' || value === null) return null;
  const { pushed, closesPr } = value as Record<string, unknown>;
  if (typeof pushed !== 'boolean' || !(closesPr === null || typeof closesPr === 'number')) throw new HttpError(400, 'seen must be { pushed, closesPr }');
  return { pushed, closesPr };
}

// GET /api/crs: { enabled, crs, taken, prError, fetchError } (`?fresh=1`
// fetches origin and reads the pull requests again). POST /api/crs with
// { name } creates one and answers { cr }. POST /api/crs/<slug>/discard with
// { dryRun?, seen? } answers what it removes (see manager.ts); what is on
// origin only goes for an admin. Without change requests (a Studio over one
// worktree) the list is empty and `enabled` false.
export function createChangeRequestsApi(crs: ChangeRequests | null): Handler {
  async function route(request: IncomingMessage, pathname: string) {
    if (pathname === '/api/crs') {
      if (request.method === 'GET') {
        if (crs === null) return { enabled: false, crs: [], taken: [], prError: null, fetchError: null };
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
    const body = await readJsonObject(request, MAX_BODY_BYTES, 'change request changes');
    return { discard: await crs.discard(slug, body.dryRun === true, seenOf(body.seen), atLeast(viewerOf(request).role, 'admin')) };
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
