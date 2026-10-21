import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from '../http.ts';
import { listEditableFiles, statOrNull, writeAtomic } from '../files/store.ts';
import { NOTES_DIR, resolveWorktreePath } from '../security/paths.ts';
import { replaceSegment, rewriteLinks, type Rename } from './links.ts';
import { insertEntry, metaTemplate, MetaEditError, moveEntry, readPages, replaceEntry } from './meta-edit.ts';
import { normalizeSlug, pageTemplate } from './template.ts';
import type { TreeFolder, TreeNode } from './types.ts';

// Page tree changes: create a page, rename a page or folder, move an entry
// within its folder. Each is planned against the disk first (the files to
// write, with the mtime each was read at), so a dry run can show it, then
// applied. Paths are relative to content/notes.

export type TreeChange =
  | { type: 'add'; path: string }
  | { type: 'change'; path: string; detail: string }
  | { type: 'move'; path: string; to: string };

type Write = { path: string; content: string; baseMtime: number | null };

export type Plan = {
  writes: Write[];
  move: { from: string; to: string } | null;
  changes: TreeChange[];
  // The note to open afterwards.
  open: string | null;
};

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
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

function findNode(folder: TreeFolder, match: (node: TreeNode) => boolean): TreeNode | null {
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
  if (typeof slug !== 'string' || slug === '' || normalizeSlug(slug) !== slug) {
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

function metaError<T>(task: () => T): T {
  try {
    return task();
  } catch (error) {
    if (error instanceof MetaEditError) throw new HttpError(409, error.message);
    throw error;
  }
}

export type CreateRequest = { parent: string; slug: unknown; title: unknown; folder: unknown; after: unknown };

// A page `<parent>/<slug>.mdx`, or a folder page `<parent>/<slug>/index.mdx`
// with its own meta.yaml, added to the parent's meta.yaml after entry
// `after` (at the end when null). A parent without meta.yaml, without a
// `pages` list or with `...` in it shows the page by itself.
export async function planCreate(root: string, tree: TreeFolder, request: CreateRequest): Promise<Plan> {
  const parent = findFolder(tree, request.parent);
  const slug = checkSlug(request.slug);
  const title = (typeof request.title === 'string' ? request.title.trim() : '') || slug;
  await checkFree(root, parent.path, slug);

  const page = request.folder === true ? inDir(inDir(parent.path, slug), 'index.mdx') : inDir(parent.path, `${slug}.mdx`);
  const writes: Write[] = [{ path: page, content: pageTemplate(slug, title), baseMtime: null }];
  if (request.folder === true) writes.push({ path: inDir(inDir(parent.path, slug), 'meta.yaml'), content: metaTemplate(title, []), baseMtime: null });

  if (parent.meta !== null) {
    const meta = await readText(root, parent.meta);
    const pages = metaError(() => readPages(meta.content));
    if (pages && !pages.some((item) => item === '...' || item === 'z...a')) {
      const at = typeof request.after === 'number' && request.after >= 0 && request.after < pages.length ? request.after + 1 : pages.length;
      const content = metaError(() => insertEntry(meta.content, slug, at));
      if (content !== null) writes.push({ path: parent.meta, content, baseMtime: meta.mtimeMs });
    }
  }
  for (const write of writes) guarded(root, write.path);
  return {
    writes,
    move: null,
    changes: writes.map((write) => (write.baseMtime === null ? { type: 'add', path: write.path } : { type: 'change', path: write.path, detail: `adds "${slug}"` })),
    open: page,
  };
}

export type RenameRequest = { path: unknown; slug: unknown };

// Gives a page or a folder a new name in the same folder, and points every
// meta.yaml entry and every Markdown link that reached it at the new name.
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
  const files = (await listEditableFiles(root)).filter((file) => file.kind !== 'asset');
  for (const file of files) {
    const notesPath = file.path.slice(NOTES_DIR.length + 1);
    const { content, mtimeMs } = await readText(root, notesPath);
    const { next, count, unit } =
      file.kind === 'meta'
        ? { ...metaError(() => renameEntries(content, dirOf(notesPath), change)), unit: ['entry', 'entries'] as const }
        : { ...rewriteLinks(content, notesPath, change), unit: ['link', 'links'] as const };
    if (next === content) continue;
    const detail = `${String(count)} ${count === 1 ? unit[0] : unit[1]}`;
    writes.push({ path: notesPath, content: next, baseMtime: mtimeMs });
    changes.push({ type: 'change', path: notesPath, detail });
  }
  return { writes, move: { from: path, to }, changes, open: null };
}

// The meta.yaml at `dir` with its entries for the renamed page or folder
// renamed too. A meta.yaml inside a renamed folder moves along with what it
// lists, so it keeps its entries.
function renameEntries(content: string, dir: string, change: Rename) {
  if (change.folder && (dir === change.from || dir.startsWith(`${change.from}/`))) return { next: content, count: 0 };
  const pages = readPages(content) ?? [];
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
      : (replaceSegment(start, raw, change.from.replace(/\.mdx$/, ''), name.replace(/\.mdx$/, '')) ??
        replaceSegment(start, raw, change.from, name));
    if (renamed === null) return;
    next = replaceEntry(next, index, prefix + renamed);
    count += 1;
  });
  return { next, count };
}

export type MoveRequest = { folder: string; from: unknown; to: unknown; baseMtime: unknown };

// Moves entry `from` of the folder's meta.yaml to index `to`. A folder
// without meta.yaml gets one, listing its children in the new order.
export async function planMove(root: string, tree: TreeFolder, request: MoveRequest): Promise<Plan> {
  const folder = findFolder(tree, request.folder);
  const { from, to } = request;
  if (typeof from !== 'number' || typeof to !== 'number') throw new HttpError(400, 'from and to must be entry indexes');
  if (folder.meta !== null) {
    const meta = await readText(root, folder.meta);
    if (request.baseMtime !== meta.mtimeMs) throw new HttpError(409, `${NOTES_DIR}/${folder.meta} changed on disk`);
    const content = metaError(() => moveEntry(meta.content, from, to));
    return { writes: [{ path: folder.meta, content, baseMtime: meta.mtimeMs }], move: null, changes: [{ type: 'change', path: folder.meta, detail: 'new order' }], open: null };
  }
  if (request.baseMtime !== null) throw new HttpError(409, `${NOTES_DIR}/${inDir(folder.path, 'meta.yaml')} changed on disk`);
  const names = folder.children
    .filter((child) => child.entry !== null && (child.kind === 'page' || child.kind === 'folder'))
    .map((child) => (child.kind === 'folder' || child.kind === 'page' ? child.path.slice(child.path.lastIndexOf('/') + 1).replace(/\.mdx$/, '') : ''));
  if (!(from >= 0 && from < names.length && to >= 0 && to < names.length)) throw new HttpError(409, 'no such entry');
  names.splice(to, 0, ...names.splice(from, 1));
  const path = inDir(folder.path, 'meta.yaml');
  guarded(root, path);
  return { writes: [{ path, content: metaTemplate(folder.title, names), baseMtime: null }], move: null, changes: [{ type: 'add', path }], open: null };
}

// Writes the plan: every file must still have the mtime it was planned
// from, then each is written atomically, then the page or folder moves.
// Not a transaction: if a write fails, the ones before it stay written and
// the error names the failed path.
export async function applyPlan(root: string, plan: Plan) {
  for (const write of plan.writes) {
    const info = await statOrNull(guarded(root, write.path));
    if ((info?.mtimeMs ?? null) !== write.baseMtime) throw new HttpError(409, `${NOTES_DIR}/${write.path} changed on disk`);
  }
  if (plan.move && (await statOrNull(absolute(root, plan.move.to)))) throw new HttpError(409, `${NOTES_DIR}/${plan.move.to} already exists`);
  for (const write of plan.writes) {
    const file = guarded(root, write.path);
    try {
      await writeAtomic(file, write.content, (await statOrNull(file))?.mode);
    } catch (error) {
      throw new HttpError(500, `could not write ${NOTES_DIR}/${write.path}: ${(error as Error).message}`);
    }
  }
  if (plan.move) await rename(absolute(root, plan.move.from), absolute(root, plan.move.to));
}
