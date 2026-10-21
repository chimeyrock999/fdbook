import { createKeyedLock } from '../files/store.ts';
import { HttpError, pathnameOf, readBody, sendJson, type Handler } from '../http.ts';
import { applyAssetPlan, listAssets, planAssetDelete, planAssetRename, type AssetPlan, type NoteScan } from './ops.ts';

const MAX_BODY_BYTES = 64 * 1024;

type Body = Record<string, unknown>;

// GET /api/assets: every file under public/notes with the notes and lines
// that use it. POST /api/assets with a JSON body
// { op: 'rename' | 'delete', path, name?, baseMtime, dryRun? } changes one
// and answers { changes, usages } (see server/assets/ops.ts); with dryRun it
// only answers. `lock` is the one page tree changes take, since both write
// notes: one change at a time, each planned from the disk it then writes.
export function createAssetsApi(root: string, lock = createKeyedLock()): Handler {
  // What was read of the notes, kept between requests (see NoteScan).
  const scan: NoteScan = new Map();

  function plan(body: Body): Promise<AssetPlan> {
    switch (body.op) {
      case 'rename':
        return planAssetRename(root, { path: body.path, name: body.name, baseMtime: body.baseMtime }, scan);
      case 'delete':
        return planAssetDelete(root, { path: body.path, baseMtime: body.baseMtime }, scan);
      default:
        throw new HttpError(400, 'op must be rename or delete');
    }
  }

  async function change(body: Body) {
    const answer = (planned: AssetPlan) => ({ changes: planned.changes, usages: planned.usages });
    if (body.dryRun === true) return answer(await plan(body));
    return lock('notes', async () => {
      const planned = await plan(body);
      await applyAssetPlan(root, planned);
      return answer(planned);
    });
  }

  async function route(request: Parameters<Handler>[0]) {
    if (request.method === 'GET') return { assets: await listAssets(root, scan) };
    if (request.method !== 'POST') throw new HttpError(405, 'method not allowed');
    // JSON only, so a browser must preflight it and a foreign page cannot send one blind.
    if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
      throw new HttpError(415, 'asset changes must be application/json');
    }
    let body: unknown;
    try {
      body = JSON.parse((await readBody(request, MAX_BODY_BYTES)).toString('utf8'));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, 'body is not JSON');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'body must be an object');
    return change(body as Body);
  }

  return async (request, response) => {
    if (pathnameOf(request) !== '/api/assets') return false;
    try {
      sendJson(response, 200, await route(request));
    } catch (error) {
      if (request.method !== 'GET' && request.method !== 'POST') response.setHeader('Allow', 'GET, POST');
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
