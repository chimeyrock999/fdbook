import { HttpError, pathnameOf, readBody, sendJson, type Handler } from '#infra/http.ts';
import { NOTES_DIR, resolveWorktreePath } from '#infra/security/paths.ts';
import { loadLintContext } from '#services/lint/context.ts';
import { lintNote } from '#services/lint/lint.ts';

const MAX_NOTE_BYTES = 5 * 1024 * 1024;

// POST /api/lint with { path, content }: the issues of `content` as the note
// at `path` (worktree-relative, a note the Studio may edit). The UI sends the
// text it holds, so unsaved edits are checked too; nothing is written.
export function createLintApi(root: string): Handler {
  async function lint(body: Buffer) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      throw new HttpError(400, 'body is not JSON');
    }
    const { path, content } = (parsed ?? {}) as { path?: unknown; content?: unknown };
    if (typeof path !== 'string' || typeof content !== 'string') {
      throw new HttpError(400, 'body must be { path: string, content: string }');
    }
    if (resolveWorktreePath(root, path)?.kind !== 'note') throw new HttpError(403, `not a note: ${path}`);
    const context = await loadLintContext(root, path.slice(NOTES_DIR.length + 1));
    return { path, issues: lintNote(content, context) };
  }

  return async (request, response) => {
    if (pathnameOf(request) !== '/api/lint') return false;
    try {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        throw new HttpError(405, 'method not allowed');
      }
      // JSON only, so a browser must preflight it and a foreign page cannot send one blind.
      if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
        throw new HttpError(415, 'lint requests must be application/json');
      }
      sendJson(response, 200, await lint(await readBody(request, MAX_NOTE_BYTES)));
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
