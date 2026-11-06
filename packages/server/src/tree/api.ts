import { HttpError, pathnameOf, readJsonObject, sendJson, type Handler } from '#http/http.ts';
import { createKeyedLock } from '#files/store.ts';
import { loadTree } from './build.ts';
import { runDelete } from './delete.ts';
import { applyPlan, planCreate, planMove, planRename, planSetOpen, planVisibility, type Plan } from './ops.ts';
import type { TreeFolder } from '@fdbook/shared/tree.ts';

const MAX_BODY_BYTES = 64 * 1024;

type Body = Record<string, unknown>;

// GET /api/tree: the page tree. POST /api/tree with a JSON body
// { op: 'create' | 'rename' | 'move' | 'set-open' | 'visibility', dryRun?, ... } changes it and answers
// { changes, open } (see server/tree/ops.ts); with dryRun it only answers.
// { op: 'delete', path, base?, dryRun? } deletes a page, folder page or
// folder; its dry run answers { changes, base, links, deleted } too, and the
// delete must send that `base` back (server/tree/delete.ts). `onDeleted` is
// told what a delete took (the proposals on those notes are dropped),
// `onMoved` which page or folder a rename or move took where (its review
// threads go with it), both relative to content/notes.
// Page tree changes go through here, never through the notes sync, which
// cannot update meta.yaml. `lock` runs one change at a time, each planned
// from the disk it then writes; asset changes (server/assets/api.ts) share
// it, since both write notes.
export function createTreeApi(root: string, lock = createKeyedLock(), { onDeleted, onMoved }: { onDeleted?: (target: string, notes: string[]) => Promise<void> | void; onMoved?: (from: string, to: string) => Promise<void> | void } = {}): Handler {

  function plan(tree: TreeFolder, body: Body): Promise<Plan> {
    const folder = typeof body.folder === 'string' ? body.folder : '';
    switch (body.op) {
      case 'create':
        return planCreate(root, tree, { parent: typeof body.parent === 'string' ? body.parent : '', slug: body.slug, title: body.title, kind: body.kind, defaultOpen: body.defaultOpen, after: body.after });
      case 'rename':
        return planRename(root, tree, { path: body.path, slug: body.slug });
      case 'move':
        return planMove(root, tree, { folder, from: body.from, to: body.to, baseMtime: body.baseMtime });
      case 'set-open':
        return planSetOpen(root, tree, { folder: body.folder, defaultOpen: body.defaultOpen, baseMtime: body.baseMtime });
      case 'visibility':
        return planVisibility(root, tree, { path: body.path, visible: body.visible });
      default:
        throw new HttpError(400, 'op must be create, rename, move, set-open, visibility or delete');
    }
  }

  async function change(body: Body) {
    if (body.op === 'delete') return runDelete(root, lock, { path: body.path, base: body.base, dryRun: body.dryRun === true }, onDeleted);
    const answer = (planned: Plan) => ({ changes: planned.changes, open: planned.open, ...(planned.created === undefined ? {} : { created: planned.created }) });
    // A dry run only reads, so it does not wait behind the changes.
    if (body.dryRun === true) return answer(await plan(await loadTree(root), body));
    return lock('notes', async () => {
      const planned = await plan(await loadTree(root), body);
      await applyPlan(root, planned);
      if (planned.move) await onMoved?.(planned.move.from, planned.move.to);
      return answer(planned);
    });
  }

  async function route(request: Parameters<Handler>[0]) {
    if (request.method === 'GET') return { tree: await loadTree(root) };
    if (request.method !== 'POST') throw new HttpError(405, 'method not allowed');
    return change(await readJsonObject(request, MAX_BODY_BYTES, 'tree changes'));
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
