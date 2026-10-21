import { createKeyedLock } from '../files/store.ts';
import { HttpError, pathnameOf, readBody, sendJson, type Handler } from '../http.ts';
import { commitChanges } from './commit.ts';
import { loadHistory } from './history.ts';
import { loadChanges } from './status.ts';

const MAX_BODY_BYTES = 1024 * 1024;

// GET /api/changes: what changed in the worktree, `{ branch, files }`
// (server/git/status.ts). POST /api/changes with JSON `{ message, paths }`
// commits those files and answers the commit (server/git/commit.ts).
// GET /api/changes/history: the change request's commits, `{ base, commits }`.
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

  return async (request, response) => {
    const pathname = pathnameOf(request);
    if (pathname !== '/api/changes' && pathname !== '/api/changes/history') return false;
    const allowed = pathname === '/api/changes' ? ['GET', 'POST'] : ['GET'];
    try {
      if (!allowed.includes(request.method ?? '')) throw new HttpError(405, 'method not allowed');
      const answer = pathname === '/api/changes/history' ? await loadHistory(root) : request.method === 'POST' ? await commit(request) : await loadChanges(root);
      sendJson(response, 200, answer);
    } catch (error) {
      if (!allowed.includes(request.method ?? '')) response.setHeader('Allow', allowed.join(', '));
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
