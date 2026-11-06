import { createKeyedLock } from '#services/files/store.ts';
import type { IncomingMessage } from 'node:http';
import { HttpError, pathnameOf, readBody, readJsonObject, sendJson, type Handler } from '#infra/http.ts';
import { MAX_ASSET_BYTES } from '@fdbook/shared/asset-types.ts';
import { applyAssetPlan, listAssets, planAssetDelete, planAssetRename, type AssetPlan, type NoteScan } from '#services/assets/ops.ts';
import { planAssetReplace } from '#services/assets/replace.ts';

const MAX_BODY_BYTES = 64 * 1024;

type Body = Record<string, unknown>;

// GET /api/assets: every file under public/notes with the notes and lines
// that use it. POST /api/assets with a JSON body
// { op: 'rename' | 'delete' | 'replace', path, name?, extension?, baseMtime, dryRun? }
// changes one and answers { changes, usages } (see services/assets/ops.ts);
// with dryRun it only answers. A replace carries the new file, so it is
// applied with PUT /api/assets?path=…&extension=…&baseMtime=…, the raw
// bytes and X-Studio-Write: 1, and answers the asset's new mtime too. `lock`
// is the one page tree changes take, since both write notes: one change at
// a time, each planned from the disk it then writes.
export function createAssetsApi(root: string, lock = createKeyedLock()): Handler {
  // What was read of the notes, kept between requests (see NoteScan).
  const scan: NoteScan = new Map();

  function plan(body: Body): Promise<AssetPlan> {
    switch (body.op) {
      case 'rename':
        return planAssetRename(root, { path: body.path, name: body.name, baseMtime: body.baseMtime }, scan);
      case 'delete':
        return planAssetDelete(root, { path: body.path, baseMtime: body.baseMtime }, scan);
      case 'replace':
        return planAssetReplace(root, { path: body.path, extension: body.extension, baseMtime: body.baseMtime }, scan);
      default:
        throw new HttpError(400, 'op must be rename, delete or replace');
    }
  }

  const answer = (planned: AssetPlan) => ({ changes: planned.changes, usages: planned.usages });

  async function change(body: Body) {
    if (body.dryRun === true) return answer(await plan(body));
    if (body.op === 'replace') throw new HttpError(400, 'a replace sends the new file: PUT /api/assets with its bytes');
    return lock('notes', async () => {
      const planned = await plan(body);
      await applyAssetPlan(root, planned);
      return answer(planned);
    });
  }

  // The request is planned once before its bytes are read, so a refused one
  // (a stale mtime, a type not stored) is not uploaded
  // first; the bytes are read outside the lock, and planned again inside it.
  async function replace(request: IncomingMessage) {
    // A custom header, so a browser must preflight it and a foreign page cannot send one blind.
    if (request.headers['x-studio-write'] !== '1') throw new HttpError(415, 'asset writes need X-Studio-Write: 1');
    const query = new URL(request.url ?? '/', 'http://studio').searchParams;
    const mtime = query.get('baseMtime');
    const body = { op: 'replace', path: query.get('path'), extension: query.get('extension') ?? '', baseMtime: mtime === null || mtime === '' ? null : Number(mtime) };
    await plan(body);
    const content = await readBody(request, MAX_ASSET_BYTES);
    return lock('notes', async () => {
      const planned = await plan(body);
      const mtimeMs = await applyAssetPlan(root, planned, content);
      return { ...answer(planned), mtimeMs };
    });
  }

  async function route(request: Parameters<Handler>[0]) {
    if (request.method === 'GET') return { assets: await listAssets(root, scan) };
    if (request.method === 'PUT') return replace(request);
    if (request.method !== 'POST') throw new HttpError(405, 'method not allowed');
    return change(await readJsonObject(request, MAX_BODY_BYTES, 'asset changes'));
  }

  return async (request, response) => {
    if (pathnameOf(request) !== '/api/assets') return false;
    try {
      sendJson(response, 200, await route(request));
    } catch (error) {
      if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'PUT') response.setHeader('Allow', 'GET, POST, PUT');
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
