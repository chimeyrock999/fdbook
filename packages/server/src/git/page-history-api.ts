import { createKeyedLock } from '#files/store.ts';
import { HttpError, pathnameOf, readJsonObject, sendJson, type Handler } from '#http/http.ts';
import { loadDeletedPages, restoreDeletedPage } from './deleted-pages.ts';
import { comparePageVersions, loadPageHistory, restorePageVersion } from './page-history.ts';

const MAX_BODY_BYTES = 16 * 1024;

// GET /api/history?path=…: a page's or an asset's versions, `{ path,
// mtimeMs, deleted, versions }` (server/git/page-history.ts).
// GET /api/history/compare?path=…&to=…[&from=…]: two versions of it, a
// commit sha or `now`. POST /api/history/restore with JSON `{ path, sha,
// mtimeMs }` writes version `sha` over the file. GET /api/history/deleted:
// the pages deleted on HEAD (server/git/deleted-pages.ts); POST
// /api/history/restore-deleted with `{ path, sha, dryRun? }` brings one
// back. Writes take `lock` with the tree, asset and commit changes.
export function createPageHistoryApi(root: string, lock = createKeyedLock()): Handler {
  const routes: Record<string, { method: string; answer: (request: Parameters<Handler>[0], query: URLSearchParams) => Promise<unknown> }> = {
    '/api/history': { method: 'GET', answer: (_request, query) => loadPageHistory(root, pathOf(query)) },
    '/api/history/compare': { method: 'GET', answer: (_request, query) => comparePageVersions(root, pathOf(query), query.get('from'), query.get('to')) },
    '/api/history/restore': {
      method: 'POST',
      answer: async (request) => {
        const body = await readJsonObject(request, MAX_BODY_BYTES, 'a restore');
        return lock('notes', () => restorePageVersion(root, { path: body.path, sha: body.sha, mtimeMs: body.mtimeMs }));
      },
    },
    '/api/history/deleted': { method: 'GET', answer: () => loadDeletedPages(root) },
    '/api/history/restore-deleted': {
      method: 'POST',
      answer: async (request) => {
        const body = await readJsonObject(request, MAX_BODY_BYTES, 'a restore');
        return lock('notes', () => restoreDeletedPage(root, { path: body.path, sha: body.sha, dryRun: body.dryRun }));
      },
    },
  };

  return async (request, response) => {
    const route = Object.hasOwn(routes, pathnameOf(request)) ? routes[pathnameOf(request)] : undefined;
    if (route === undefined) return false;
    try {
      if (request.method !== route.method) {
        response.setHeader('Allow', route.method);
        throw new HttpError(405, 'method not allowed');
      }
      sendJson(response, 200, await route.answer(request, new URL(request.url ?? '/', 'http://studio').searchParams));
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}

function pathOf(query: URLSearchParams) {
  const path = query.get('path');
  if (!path) throw new HttpError(400, 'missing ?path=');
  return path;
}
