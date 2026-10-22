import { createKeyedLock } from '../files/store.ts';
import { HttpError, pathnameOf, readJsonObject, sendJson, type Handler } from '../http.ts';
import { loadPreview, pushPreview, type Preview, type PreviewOptions } from './preview.ts';

const MAX_BODY_BYTES = 1024;

const READ_ONLY: Preview = { branch: null, blocked: 'Main is read only: preview a change request.', pushed: null, unpushed: [], uncommitted: 0, url: null, build: null };

// GET /api/preview: the worktree's preview (preview.ts). POST /api/preview
// with a JSON `{}` pushes the change request and answers it again. A push
// takes `lock` with commits, so it never sends half of one. Main answers
// that it is read only (and refuses the POST before it gets here).
export function createPreviewApi(root: string, options: PreviewOptions, { readOnly = false, lock = createKeyedLock() } = {}): Handler {
  return async (request, response) => {
    if (pathnameOf(request) !== '/api/preview') return false;
    try {
      let answer: Preview;
      if (request.method === 'GET') answer = readOnly ? READ_ONLY : await loadPreview(root, options);
      else if (request.method === 'POST') {
        await readJsonObject(request, MAX_BODY_BYTES, 'a push');
        answer = await lock('notes', () => pushPreview(root, options));
      } else {
        response.setHeader('Allow', 'GET, POST');
        throw new HttpError(405, 'method not allowed');
      }
      sendJson(response, 200, answer);
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
