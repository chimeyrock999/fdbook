import { HttpError, pathnameOf, sendJson, type Handler } from '../http.ts';
import { siteIconNames } from './names.ts';

// GET /api/icons: the lucide names a note's `icon` can take (names.ts).
export function createIconsApi(): Handler {
  return async (request, response) => {
    if (pathnameOf(request) !== '/api/icons') return false;
    try {
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        throw new HttpError(405, 'method not allowed');
      }
      sendJson(response, 200, { names: await siteIconNames() });
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
