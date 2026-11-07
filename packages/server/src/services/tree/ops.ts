import { readFile, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { HttpError } from '#infra/http.ts';
import { buildTree, readNotesContent } from './build.ts';
import { listEditableFiles, statOrNull, writeAtomic } from '#services/files/store.ts';
import { ASSETS_DIR, EDITABLE_AREAS, NOTES_DIR, resolveWorktreePath } from '#infra/security/paths.ts';
import { knownTargets, replaceSegment, rewriteLinks, type Rename } from './links.ts';
import { MetaEditError } from './meta-edit.ts';
import { metaEditor, newMetaName } from './meta-file.ts';
import { slugify } from '@fdbook/shared/slug.ts';
import { pageTemplate } from './template.ts';
import { writeMetaVisible, writePageVisible } from './visible-edit.ts';
import type { TreeFolder, TreeNode, TreePage } from '@fdbook/shared/tree.ts';

// Page tree changes: create a page, rename a page or folder, move an entry
// within its folder, hide or show a page or folder (a delete is in
// delete.ts). Each is planned against the disk first (the files to
// write, with the mtime each was read at), so a dry run can show it, then
// applied. Paths are relative to content/notes.

export type TreeChange =
  | { type: 'add'; path: string }
  | { type: 'change'; path: string; detail: string }
  | { type: 'move'; path: string; to: string }
  | { type: 'delete'; path: string }
  // Left where it is: a page's images in public/notes (a worktree path).
  | { type: 'keep'; path: string; detail: string };

type Write = { path: string; content: string; baseMtime: number | null };

export type Plan = {
  writes: Write[];
  // A file to remove, with the mtime it was read at.
  remove?: { path: string; baseMtime: number };
  // Files a delete removes, by worktree path (content/notes/…, public/notes/…),
  // with the mtime each was read at; their folders go once empty.
  deletes?: { path: string; baseMtime: number }[];
  move: { from: string; to: string } | null;
  changes: TreeChange[];
  // The note to open afterwards.
  open: string | null;
  // Set by a create: the page or folder it adds.
  created?: string;
};

const slugOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.mdx$/, '');
export const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const inDir = (dir: string, name: string) => (dir === '' ? name : `${dir}/${name}`);
const absolute = (root: string, path: string) => join(root, NOTES_DIR, path);

// The worktree path of `path`, checked against the path policy.
function guarded(root: string, path: string) {
  const resolved = resolveWorktreePath(root, `${NOTES_DIR}/${path}`);
  if (!resolved) throw new HttpError(403, `not an editable path: ${NOTES_DIR}/${path}`);
  return resolved.absolute;
}

async function readText(root: string, path: string) {
  const file = guarded(root, path);
  const info = await statOrNull(file);
  if (!info?.isFile()) throw new HttpError(404, `no such file: ${NOTES_DIR}/${path}`);
  return { content: await readFile(file, 'utf8'), mtimeMs: info.mtimeMs };
}

export function findNode(folder: TreeFolder, match: (node: TreeNode) => boolean): TreeNode | null {
  for (const child of folder.children) {
    if (match(child)) return child;
    if (child.kind === 'folder') {
      const found = findNode(child, match);
      if (found) return found;
    }
  }
  return null;
}

function findFolder(tree: TreeFolder, path: string) {
  const folder = path === '' ? tree : findNode(tree, (node) => node.kind === 'folder' && node.path === path);
  if (folder?.kind !== 'folder') throw new HttpError(404, `no such folder: ${NOTES_DIR}/${path}`);
  return folder;
}

function checkSlug(slug: unknown): string {
  if (typeof slug !== 'string' || slug === '' || slugify(slug) !== slug) {
    throw new HttpError(400, 'the slug must be lowercase letters, digits and dashes');
  }
  if (slug === 'index') throw new HttpError(400, '`index` is the folder page: name the folder instead');
  return slug;
}

// A page `<slug>.mdx` and a folder `<slug>/` would share a URL.
async function checkFree(root: string, dir: string, slug: string) {
  for (const path of [inDir(dir, `${slug}.mdx`), inDir(dir, slug)]) {
    if (await statOrNull(absolute(root, path))) throw new HttpError(409, `${NOTES_DIR}/${path} already exists`);
  }
}

export function metaError<T>(task: () => T): T {
  try {
    return task();
  } catch (error) {
    if (error instanceof MetaEditError) throw new HttpError(409, error.message);
    throw error;
  }
}

export type CreateRequest = { parent: string; slug: unknown; title: unknown; kind: unknown; defaultOpen: unknown; after: unknown };

const CREATE_KINDS = ['page', 'folder-page', 'plain-folder'] as const;

// A page `<parent>/<slug>.mdx`, a folder page `<parent>/<slug>/index.mdx`
// with its own meta file, or a plain folder with only its meta file (in the
// format newMetaName says), added to the parent's meta file after entry
// `after` (at the end when null). A parent without a meta file, without a
// `pages` list or with `...` in it shows the new node by itself. A new
// folder is closed in the site's sidebar unless `defaultOpen`.
export async function planCreate(root: string, tree: TreeFolder, request: CreateRequest): Promise<Plan> {
  const parent = findFolder(tree, request.parent);
  const kind = request.kind ?? 'page';
  // `folder` meant a folder page before plain folders came: a page loaded
  // before then would get the wrong kind, so it is refused.
  if (kind === 'folder') throw new HttpError(400, 'kind `folder` is now `folder-page`: reload the Studio');
  if (!CREATE_KINDS.some((each) => each === kind)) throw new HttpError(400, 'kind must be page, folder-page or plain-folder');
  const slug = checkSlug(request.slug);
  const title = (typeof request.title === 'string' ? request.title.trim() : '') || slug;
  await checkFree(root, parent.path, slug);

  const folder = inDir(parent.path, slug);
  const page: string | null = kind === 'page' ? inDir(parent.path, `${slug}.mdx`) : kind === 'folder-page' ? inDir(folder, 'index.mdx') : null;
  const writes: Write[] = page === null ? [] : [{ path: page, content: pageTemplate(title), baseMtime: null }];
  if (kind !== 'page') {
    const name = await newMetaName(root);
    writes.push({ path: inDir(folder, name), content: metaEditor(name).metaTemplate(title, [], request.defaultOpen === true), baseMtime: null });
  }

  if (parent.meta !== null) {
    const edit = metaEditor(parent.meta);
    const meta = await readText(root, parent.meta);
    const pages = metaError(() => edit.readPages(meta.content));
    if (pages && !pages.some((item) => item === '...' || item === 'z...a')) {
      const at = typeof request.after === 'number' && request.after >= 0 && request.after < pages.length ? request.after + 1 : pages.length;
      const content = metaError(() => edit.insertEntry(meta.content, slug, at));
      if (content !== null) writes.push({ path: parent.meta, content, baseMtime: meta.mtimeMs });
    }
  }
  for (const write of writes) guarded(root, write.path);
  return {
    writes,
    move: null,
    changes: writes.map((write) => (write.baseMtime === null ? { type: 'add', path: write.path } : { type: 'change', path: write.path, detail: `adds "${slug}"` })),
    open: page,
    created: kind === 'page' ? (page ?? folder) : folder,
  };
}

export type SetOpenRequest = { folder: unknown; defaultOpen: unknown; baseMtime: unknown };

// Sets `defaultOpen` in the folder's meta file, which it must have: the
// site's root folder has no open state.
export async function planSetOpen(root: string, tree: TreeFolder, request: SetOpenRequest): Promise<Plan> {
  if (typeof request.folder !== 'string') throw new HttpError(400, 'folder must be a folder path');
  if (request.folder === '') throw new HttpError(400, 'the root folder is always open');
  const folder = findFolder(tree, request.folder);
  if (typeof request.defaultOpen !== 'boolean') throw new HttpError(400, 'defaultOpen must be true or false');
  if (folder.meta === null) throw new HttpError(409, `${NOTES_DIR}/${folder.path} has no meta.json or meta.yaml`);
  const meta = await readText(root, folder.meta);
  if (request.baseMtime !== meta.mtimeMs) throw new HttpError(409, `${NOTES_DIR}/${folder.meta} changed on disk`);
  const edit = metaEditor(folder.meta);
  const content = metaError(() => edit.setFlag(meta.content, 'defaultOpen', request.defaultOpen as boolean));
  if (content === meta.content) return { writes: [], move: null, changes: [], open: null };
  return {
    writes: [{ path: folder.meta, content, baseMtime: meta.mtimeMs }],
    move: null,
    changes: [{ type: 'change', path: folder.meta, detail: `defaultOpen: ${String(request.defaultOpen)}` }],
    open: null,
  };
}

export type RenameRequest = { path: unknown; slug: unknown };

// Gives a page or a folder a new name in the same folder, and points every
// meta file entry and every Markdown link that reached it at the new name.
export async function planRename(root: string, tree: TreeFolder, request: RenameRequest): Promise<Plan> {
  const path = typeof request.path === 'string' ? request.path : '';
  if (path === 'index.mdx') throw new HttpError(400, 'the root page cannot be renamed');
  if (path.endsWith('/index.mdx')) throw new HttpError(400, 'rename the folder to rename its index page');
  const node = path === '' ? null : findNode(tree, (each) => (each.kind === 'page' || each.kind === 'folder') && each.path === path);
  if (node?.kind !== 'page' && node?.kind !== 'folder') throw new HttpError(404, `no such page or folder: ${NOTES_DIR}/${path}`);
  const slug = checkSlug(request.slug);
  const dir = dirOf(path);
  const to = inDir(dir, node.kind === 'folder' ? slug : `${slug}.mdx`);
  if (to === path) throw new HttpError(400, 'the name did not change');
  await checkFree(root, dir, slug);
  for (const each of [path, to]) guarded(root, node.kind === 'folder' ? `${each}/meta.yaml` : each);
  const change: Rename = { from: path, to, folder: node.kind === 'folder' };

  const writes: Write[] = [];
  const changes: TreeChange[] = [{ type: 'move', path, to }];
  const all = await listEditableFiles(root);
  const files = all.filter((file) => file.kind === 'note' || file.kind === 'meta');
  const known = knownTargets(files.filter((file) => file.kind === 'note').map((file) => file.path.slice(NOTES_DIR.length + 1)));
  // A file that does not hold the old name cannot point at it: skip the parse.
  const oldName = slugOf(path);
  const read = await Promise.all(
    files.map(async (file) => {
      const notesPath = file.path.slice(NOTES_DIR.length + 1);
      return { kind: file.kind, notesPath, ...(await readText(root, notesPath)) };
    }),
  );
  for (const { kind, notesPath, content, mtimeMs } of read) {
    if (!content.includes(oldName)) continue;
    const { next, count, unit } =
      kind === 'meta'
        ? { ...metaError(() => renameEntries(content, notesPath, change)), unit: ['entry', 'entries'] as const }
        : { ...rewriteLinks(content, notesPath, change, known), unit: ['link', 'links'] as const };
    if (next === content) continue;
    const detail = `${String(count)} ${count === 1 ? unit[0] : unit[1]}`;
    writes.push({ path: notesPath, content: next, baseMtime: mtimeMs });
    changes.push({ type: 'change', path: notesPath, detail });
  }
  // The page's images stay in public/notes/<old path>/: a rename does not
  // move assets yet. Their links are left as they are, so they keep working;
  // the plan says so, for the dry run.
  const images = `${ASSETS_DIR}/${path.replace(/\.mdx$/, '')}/`;
  const kept = all.filter((file) => file.kind === 'asset' && file.path.startsWith(images)).length;
  if (kept > 0) changes.push({ type: 'keep', path: images, detail: `${String(kept)} ${kept === 1 ? 'file stays' : 'files stay'}` });
  return { writes, move: { from: path, to }, changes, open: null };
}

// The meta file at `path` with its entries for the renamed page or folder
// renamed too. A meta file inside a renamed folder moves along with what it
// lists, so it keeps its entries.
function renameEntries(content: string, path: string, change: Rename) {
  const dir = dirOf(path);
  if (change.folder && (dir === change.from || dir.startsWith(`${change.from}/`))) return { next: content, count: 0 };
  const edit = metaEditor(path);
  const pages = edit.readPages(content) ?? [];
  const name = change.to.slice(change.to.lastIndexOf('/') + 1);
  const start = dir === '' ? [] : dir.split('/');
  let next = content;
  let count = 0;
  pages.forEach((item, index) => {
    if (typeof item !== 'string' || item === '...' || item === 'z...a') return;
    const prefix = /^(!|\.\.\.)/.exec(item)?.[0] ?? '';
    const raw = item.slice(prefix.length);
    const renamed = change.folder
      ? replaceSegment(start, raw, change.from, name)
      : (replaceSegment(start, raw, change.from.replace(/\.mdx$/, ''), name.replace(/\.mdx$/, ''), true) ??
        replaceSegment(start, raw, change.from, name, true));
    if (renamed === null) return;
    next = edit.replaceEntry(next, index, prefix + renamed);
    count += 1;
  });
  return { next, count };
}

// The names of a folder's children in their order, as a `pages` list for a
// folder that has no meta file yet.
function listedNames(folder: TreeFolder) {
  return folder.children
    .filter((child): child is TreePage | TreeFolder => child.entry !== null && (child.kind === 'page' || child.kind === 'folder'))
    .map((child) => slugOf(child.path));
}

export type MoveRequest = { folder: string; from: unknown; to: unknown; baseMtime: unknown };

// Moves entry `from` of the folder's meta file to index `to`. A folder
// without one gets one, listing its children in the new order.
export async function planMove(root: string, tree: TreeFolder, request: MoveRequest): Promise<Plan> {
  const folder = findFolder(tree, request.folder);
  const { from, to } = request;
  if (typeof from !== 'number' || typeof to !== 'number') throw new HttpError(400, 'from and to must be entry indexes');
  if (folder.meta !== null) {
    const meta = await readText(root, folder.meta);
    if (request.baseMtime !== meta.mtimeMs) throw new HttpError(409, `${NOTES_DIR}/${folder.meta} changed on disk`);
    const edit = metaEditor(folder.meta);
    const content = metaError(() => edit.moveEntry(meta.content, from, to));
    return { writes: [{ path: folder.meta, content, baseMtime: meta.mtimeMs }], move: null, changes: [{ type: 'change', path: folder.meta, detail: 'new order' }], open: null };
  }
  const name = await newMetaName(root);
  if (request.baseMtime !== null) throw new HttpError(409, `${NOTES_DIR}/${inDir(folder.path, name)} changed on disk`);
  const names = listedNames(folder);
  if (!(from >= 0 && from < names.length && to >= 0 && to < names.length)) throw new HttpError(409, 'no such entry');
  names.splice(to, 0, ...names.splice(from, 1));
  const path = inDir(folder.path, name);
  guarded(root, path);
  // Only `pages`: the folder keeps its title from the index page and stays
  // closed by default, as it was without a meta file.
  return { writes: [{ path, content: metaEditor(name).pagesTemplate(names), baseMtime: null }], move: null, changes: [{ type: 'add', path }], open: null };
}

export type VisibilityRequest = { path: unknown; visible: unknown };

// Hides a page or folder from the site's sidebar (`visible: false` in its
// frontmatter or meta file), or shows it again (the key comes out). A
// folder without a meta file gets one only to hide it, and loses it again
// when shown, unless its order changed since. An unlisted node shown again
// is also listed in its folder's `pages`: its `!name` entry becomes `name`,
// or it is added at the end, as a create adds.
export async function planVisibility(root: string, tree: TreeFolder, request: VisibilityRequest): Promise<Plan> {
  const path = typeof request.path === 'string' ? request.path : '';
  if (path === '' || path === 'index.mdx') throw new HttpError(400, 'the root page and folder are always shown');
  if (typeof request.visible !== 'boolean') throw new HttpError(400, 'visible must be true or false');
  const visible = request.visible;
  const node = findNode(tree, (each) => (each.kind === 'page' || each.kind === 'folder') && each.path === path);
  if (node?.kind !== 'page' && node?.kind !== 'folder') throw new HttpError(404, `no such page or folder: ${NOTES_DIR}/${path}`);

  const plan: Plan = { writes: [], move: null, changes: [], open: null };
  if (visible && node.hidden === 'unlisted') await listInParent(root, tree, path, plan);
  const file = node.kind === 'folder' ? node.meta : node.path;
  if (node.kind === 'folder' && file === null) {
    if (!visible) {
      const meta = inDir(path, await newMetaName(root));
      guarded(root, meta);
      // With its children listed, as a move would, so they can still be
      // ordered: a meta file without `pages` gives them no entries.
      plan.writes.unshift({ path: meta, content: metaEditor(meta).hiddenTemplate(listedNames(node)), baseMtime: null });
      plan.changes.unshift({ type: 'add', path: meta });
    }
  } else if (file !== null) {
    const current = await readText(root, file);
    const content = metaError(() => (node.kind === 'folder' ? writeMetaVisible(current.content, visible, file) : writePageVisible(current.content, visible)));
    if (node.kind === 'folder' && visible && current.content === metaEditor(file).hiddenTemplate(await namesWithoutMeta(root, file, path))) {
      plan.remove = { path: file, baseMtime: current.mtimeMs };
      plan.changes.unshift({ type: 'delete', path: file });
    } else if (content !== current.content) {
      plan.writes.unshift({ path: file, content, baseMtime: current.mtimeMs });
      plan.changes.unshift({ type: 'change', path: file, detail: visible ? 'removes visible: false' : 'visible: false' });
    }
  }
  return plan;
}

// The order the folder's children would have without its meta file.
async function namesWithoutMeta(root: string, meta: string, path: string) {
  const content = await readNotesContent(root);
  content.metas.delete(meta);
  return listedNames(findFolder(buildTree(content), path));
}

// Puts the unlisted node at `path` in its folder's `pages`.
async function listInParent(root: string, tree: TreeFolder, path: string, plan: Plan) {
  const parent = findFolder(tree, dirOf(path));
  if (parent.meta === null) return;
  const edit = metaEditor(parent.meta);
  const meta = await readText(root, parent.meta);
  const pages = metaError(() => edit.readPages(meta.content)) ?? [];
  const slug = slugOf(path);
  // A page `x.mdx` next to a folder `x/`: the entry reaches the folder.
  if (pages.includes(slug)) throw new HttpError(409, `"${slug}" in ${NOTES_DIR}/${parent.meta} already names another page or folder: rename one of them first`);
  const excluded = pages.indexOf(`!${slug}`);
  const content = excluded === -1 ? metaError(() => edit.insertEntry(meta.content, slug, pages.length)) : metaError(() => edit.replaceEntry(meta.content, excluded, slug));
  if (content === null) return;
  plan.writes.push({ path: parent.meta, content, baseMtime: meta.mtimeMs });
  plan.changes.push({ type: 'change', path: parent.meta, detail: excluded === -1 ? `adds "${slug}"` : `"!${slug}" becomes "${slug}"` });
}

// Where `path` is after the plan's move.
function movedPath(path: string, move: Plan['move']) {
  if (!move) return path;
  if (path === move.from) return move.to;
  return path.startsWith(`${move.from}/`) ? move.to + path.slice(move.from.length) : path;
}

// Writes the plan. Every file must still have the mtime it was planned
// from, checked once for all and again just before each write. The page or
// folder moves first, so a move that fails leaves everything as it was;
// then each file is written atomically, at its place after the move, and
// the file to remove goes last. Not a transaction: if a write fails, the
// ones before it stay written and the error names the failed path.
export async function applyPlan(root: string, plan: Plan) {
  const check = async (path: string, baseMtime: number | null) => {
    const info = await statOrNull(guarded(root, path));
    if ((info?.mtimeMs ?? null) !== baseMtime) throw new HttpError(409, `${NOTES_DIR}/${path} changed on disk`);
    return info;
  };
  const checkFile = async (path: string, baseMtime: number) => {
    if ((await statOrNull(worktreeFile(root, path)))?.mtimeMs !== baseMtime) throw new HttpError(409, `${path} changed on disk`);
  };
  for (const write of plan.writes) await check(write.path, write.baseMtime);
  if (plan.remove) await check(plan.remove.path, plan.remove.baseMtime);
  for (const file of plan.deletes ?? []) await checkFile(file.path, file.baseMtime);
  if (plan.move) {
    if (!(await statOrNull(absolute(root, plan.move.from)))) throw new HttpError(409, `${NOTES_DIR}/${plan.move.from} is gone`);
    if (await statOrNull(absolute(root, plan.move.to))) throw new HttpError(409, `${NOTES_DIR}/${plan.move.to} already exists`);
    await rename(absolute(root, plan.move.from), absolute(root, plan.move.to));
  }
  for (const write of plan.writes) {
    const path = movedPath(write.path, plan.move);
    const info = await check(path, write.baseMtime);
    try {
      await writeAtomic(guarded(root, path), write.content, info?.mode);
    } catch (error) {
      throw new HttpError(500, `could not write ${NOTES_DIR}/${path}: ${(error as Error).message}`);
    }
  }
  if (plan.remove) {
    await check(plan.remove.path, plan.remove.baseMtime);
    await rm(guarded(root, plan.remove.path));
  }
  for (const file of plan.deletes ?? []) {
    await checkFile(file.path, file.baseMtime);
    await rm(worktreeFile(root, file.path));
  }
  await removeEmptyFolders(root, (plan.deletes ?? []).map((file) => file.path));
}

function worktreeFile(root: string, path: string) {
  const resolved = resolveWorktreePath(root, path);
  if (!resolved) throw new HttpError(403, `not an editable path: ${path}`);
  return resolved.absolute;
}

// The folders the deleted files leave empty, deepest first, up to (not
// including) content/notes or public/notes. One that still holds anything
// (a file the Studio does not manage) stays.
async function removeEmptyFolders(root: string, paths: string[]) {
  const folders = new Set<string>();
  for (const path of paths) {
    for (let dir = dirname(path); dir.includes('/') && !EDITABLE_AREAS.includes(dir); dir = dirname(dir)) folders.add(dir);
  }
  for (const dir of [...folders].sort((a, b) => b.split('/').length - a.split('/').length)) {
    await rmdir(join(root, dir)).catch(() => undefined);
  }
}
