import { HttpError, pathnameOf, sendJson, type Handler } from '../http.ts';

// GET /api/icons: the lucide names a note's `icon` can take. Node loads
// lib/notes-icons.ts with the site's own lucide-react; in the browser, Vite
// would hand it the Studio's, a newer set with other names.
export function createIconsApi(): Handler {
  let names: Promise<readonly string[]> | null = null;
  return async (request, response) => {
    if (pathnameOf(request) !== '/api/icons') return false;
    try {
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        throw new HttpError(405, 'method not allowed');
      }
      names ??= import('../../../../lib/notes-icons.ts').then((module) => module.NOTE_ICON_NAMES);
      // A failed load (lucide-react still installing) is tried again.
      names.catch(() => {
        names = null;
      });
      sendJson(response, 200, { names: await names });
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
