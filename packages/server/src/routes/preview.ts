import { createKeyedLock } from '#services/files/store.ts';
import { HttpError, pathnameOf, readJsonObject, sendJson, type Handler } from '#infra/http.ts';
import { blockedOnly, loadPreview, pushPreview, type PreviewOptions } from '#services/preview/preview.ts';
import { viewerOf } from '#services/auth/access.ts';
import { BODY_MAX, loadDraft, publish } from '#services/preview/publish.ts';

const MAX_BODY_BYTES = 1024;
// A title and a description up to BODY_MAX characters in JSON: at most 6
// bytes a character (a control character escaped as \uXXXX).
const MAX_PUBLISH_BYTES = BODY_MAX * 6 + 4096;

const READ_ONLY = 'Main is read only: preview a change request.';

// GET /api/preview: the worktree's preview (services/preview/preview.ts).
// POST /api/preview with a JSON `{}` pushes the change request and answers
// it again. GET /api/publish: the draft of its pull request; POST
// /api/publish with JSON `{ title, body }` pushes and opens the pull request
// (services/preview/publish.ts), answering the preview. Pushes take `lock`
// with commits, so they never send half of one. Main answers that it is
// read only (and refuses the POSTs before they get here).
export function createPreviewApi(root: string, options: PreviewOptions, { readOnly = false, lock = createKeyedLock() } = {}): Handler {
  async function answer(pathname: string, request: Parameters<Handler>[0]): Promise<unknown> {
    if (pathname === '/api/preview') {
      if (request.method === 'GET') return readOnly ? blockedOnly(null, READ_ONLY) : loadPreview(root, options);
      await readJsonObject(request, MAX_BODY_BYTES, 'a push');
      return lock('notes', () => pushPreview(root, options));
    }
    if (readOnly) throw new HttpError(409, READ_ONLY);
    if (request.method === 'GET') return loadDraft(root, options);
    const body = await readJsonObject(request, MAX_PUBLISH_BYTES, 'a publish');
    return lock('notes', () => publish(root, options, body, viewerOf(request).user?.login ?? null));
  }

  return async (request, response) => {
    const pathname = pathnameOf(request);
    if (pathname !== '/api/preview' && pathname !== '/api/publish') return false;
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        response.setHeader('Allow', 'GET, POST');
        throw new HttpError(405, 'method not allowed');
      }
      sendJson(response, 200, await answer(pathname, request));
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
