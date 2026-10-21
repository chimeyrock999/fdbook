import { HttpError, pathnameOf, readBody, sendJson, type Handler } from '../http.ts';
import { createKeyedLock } from '../files/store.ts';
import { loadTree } from './build.ts';
import { applyPlan, planCreate, planMove, planRename, type Plan } from './ops.ts';
import type { TreeFolder } from './types.ts';

const MAX_BODY_BYTES = 64 * 1024;

type Body = Record<string, unknown>;

// GET /api/tree: the page tree. POST /api/tree with a JSON body
// { op: 'create' | 'rename' | 'move', dryRun?, ... } changes it and answers
// { changes, open } (see server/tree/ops.ts); with dryRun it only answers.
// Page tree changes go through here, never through the notes sync, which
// cannot update meta.yaml.
export function createTreeApi(root: string): Handler {
  // One tree change at a time: each plans from the disk it then writes.
  const lock = createKeyedLock();

  function plan(tree: TreeFolder, body: Body): Promise<Plan> {
    const folder = typeof body.folder === 'string' ? body.folder : '';
    switch (body.op) {
      case 'create':
        return planCreate(root, tree, { parent: typeof body.parent === 'string' ? body.parent : '', slug: body.slug, title: body.title, folder: body.kind === 'folder', after: body.after });
      case 'rename':
        return planRename(root, tree, { path: body.path, slug: body.slug });
      case 'move':
        return planMove(root, tree, { folder, from: body.from, to: body.to, baseMtime: body.baseMtime });
      default:
        throw new HttpError(400, 'op must be create, rename or move');
    }
  }

  async function change(body: Body) {
    const answer = (planned: Plan) => ({ changes: planned.changes, open: planned.open });
    // A dry run only reads, so it does not wait behind the changes.
    if (body.dryRun === true) return answer(await plan(await loadTree(root), body));
    return lock('tree', async () => {
      const planned = await plan(await loadTree(root), body);
      await applyPlan(root, planned);
      return answer(planned);
    });
  }

  async function route(request: Parameters<Handler>[0]) {
    if (request.method === 'GET') return { tree: await loadTree(root) };
    if (request.method !== 'POST') throw new HttpError(405, 'method not allowed');
    // JSON only, so a browser must preflight it and a foreign page cannot send one blind.
    if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
      throw new HttpError(415, 'tree changes must be application/json');
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
    if (pathnameOf(request) !== '/api/tree') return false;
    try {
      sendJson(response, 200, await route(request));
    } catch (error) {
      if (request.method !== 'GET' && request.method !== 'POST') response.setHeader('Allow', 'GET, POST');
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
