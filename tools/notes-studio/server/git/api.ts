import { createKeyedLock } from '../files/store.ts';
import { HttpError, pathnameOf, readBody, sendJson, type Handler } from '../http.ts';
import { ASSET_TYPES, extensionOf } from '../security/paths.ts';
import { commitChanges } from './commit.ts';
import { loadBaseFile, loadDiff } from './diff.ts';
import { loadHistory } from './history.ts';
import { loadChanges } from './status.ts';

const MAX_BODY_BYTES = 1024 * 1024;

// GET /api/changes: what changed in the worktree, `{ branch, files }`
// (server/git/status.ts). POST /api/changes with JSON `{ message, paths }`
// commits those files and answers the commit (server/git/commit.ts).
// GET /api/changes/history: the change request's commits, `{ base, commits }`.
// GET /api/changes/diff?path=…[&from=…]: the file against main
// (server/git/diff.ts); GET /api/changes/blob?path=…: the file as main holds
// it at `&base=<sha>` (else at the merge base), for an image's before side.
// A commit takes `lock` with the tree and asset changes, so it never lands
// in the middle of a rename that is still writing.
export function createChangesApi(root: string, lock = createKeyedLock()): Handler {
  async function commit(request: Parameters<Handler>[0]) {
    // JSON only, so a browser must preflight it and a foreign page cannot send one blind.
    if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
      throw new HttpError(415, 'a commit must be application/json');
    }
    let body: unknown;
    try {
      body = JSON.parse((await readBody(request, MAX_BODY_BYTES)).toString('utf8'));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, 'body is not JSON');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'body must be an object');
    const { message, paths } = body as Record<string, unknown>;
    return lock('notes', () => commitChanges(root, { message, paths }));
  }

  const paths = ['/api/changes', '/api/changes/history', '/api/changes/diff', '/api/changes/blob'];

  // The JSON a request answers, or null for the blob, which this sends itself.
  async function answer(request: Parameters<Handler>[0], response: Parameters<Handler>[1], pathname: string): Promise<unknown> {
    if (pathname === '/api/changes') return request.method === 'POST' ? commit(request) : loadChanges(root);
    if (pathname === '/api/changes/history') return loadHistory(root);
    const query = new URL(request.url ?? '/', 'http://studio').searchParams;
    const path = query.get('path');
    if (!path) throw new HttpError(400, 'missing ?path=');
    if (pathname === '/api/changes/diff') return loadDiff(root, path, query.get('from') ?? undefined);
    const data = await loadBaseFile(root, path, query.get('base'));
    response.writeHead(200, {
      'Content-Type': ASSET_TYPES[extensionOf(path)] ?? 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      // As the file API serves assets: content, never run as part of the Studio.
      'Content-Security-Policy': 'sandbox',
    });
    response.end(data);
    return null;
  }

  return async (request, response) => {
    const pathname = pathnameOf(request);
    if (!paths.includes(pathname)) return false;
    const allowed = pathname === '/api/changes' ? ['GET', 'POST'] : ['GET'];
    try {
      if (!allowed.includes(request.method ?? '')) throw new HttpError(405, 'method not allowed');
      const body = await answer(request, response, pathname);
      if (body !== null) sendJson(response, 200, body);
    } catch (error) {
      if (!allowed.includes(request.method ?? '')) response.setHeader('Allow', allowed.join(', '));
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
