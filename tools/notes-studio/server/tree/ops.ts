import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from '../http.ts';
import { listEditableFiles, statOrNull, writeAtomic } from '../files/store.ts';
import { ASSETS_DIR, NOTES_DIR, resolveWorktreePath } from '../security/paths.ts';
import { knownTargets, replaceSegment, rewriteLinks, type Rename } from './links.ts';
import { insertEntry, metaTemplate, MetaEditError, moveEntry, pagesTemplate, readPages, replaceEntry, setDefaultOpen } from './meta-edit.ts';
import { slugify } from '../../src/slug.ts';
import { pageTemplate } from './template.ts';
import { writeMetaVisible, writePageVisible } from './visible-edit.ts';
import type { TreeFolder, TreeNode } from './types.ts';

// Page tree changes: create a page, rename a page or folder, move an entry
// within its folder, hide or show a page or folder. Each is planned against the disk first (the files to
// write, with the mtime each was read at), so a dry run can show it, then
// applied. Paths are relative to content/notes.

export type TreeChange =
  | { type: 'add'; path: string }
  | { type: 'change'; path: string; detail: string }
  | { type: 'move'; path: string; to: string }
  // Left where it is: a page's images in public/notes (a worktree path).
  | { type: 'keep'; path: string; detail: string };

type Write = { path: string; content: string; baseMtime: number | null };

export type Plan = {
  writes: Write[];
  move: { from: string; to: string } | null;
  changes: TreeChange[];
  // The note to open afterwards.
  open: string | null;
  // Set by a create: the page or folder it adds.
  created?: string;
};

const slugOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.mdx$/, '');
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

function metaError<T>(task: () => T): T {
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
// with its own meta.yaml, or a plain folder with only `<slug>/meta.yaml`,
// added to the parent's meta.yaml after entry `after` (at the end when
// null). A parent without meta.yaml, without a `pages` list or with `...` in
// it shows the new node by itself. A new folder is closed in the site's
// sidebar unless `defaultOpen`.
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
  const writes: Write[] = page === null ? [] : [{ path: page, content: pageTemplate(slug, title), baseMtime: null }];
  if (kind !== 'page') writes.push({ path: inDir(folder, 'meta.yaml'), content: metaTemplate(title, [], request.defaultOpen === true), baseMtime: null });

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
    created: kind === 'page' ? (page ?? folder) : folder,
  };
}

export type SetOpenRequest = { folder: unknown; defaultOpen: unknown; baseMtime: unknown };

// Sets `defaultOpen` in the folder's meta.yaml, which it must have: the
// site's root folder has no open state.
export async function planSetOpen(root: string, tree: TreeFolder, request: SetOpenRequest): Promise<Plan> {
  if (typeof request.folder !== 'string') throw new HttpError(400, 'folder must be a folder path');
  if (request.folder === '') throw new HttpError(400, 'the root folder is always open');
  const folder = findFolder(tree, request.folder);
  if (typeof request.defaultOpen !== 'boolean') throw new HttpError(400, 'defaultOpen must be true or false');
  if (folder.meta === null) throw new HttpError(409, `${NOTES_DIR}/${inDir(folder.path, 'meta.yaml')} does not exist`);
  const meta = await readText(root, folder.meta);
  if (request.baseMtime !== meta.mtimeMs) throw new HttpError(409, `${NOTES_DIR}/${folder.meta} changed on disk`);
  const content = metaError(() => setDefaultOpen(meta.content, request.defaultOpen as boolean));
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
  const all = await listEditableFiles(root);
  const files = all.filter((file) => file.kind !== 'asset');
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
        ? { ...metaError(() => renameEntries(content, dirOf(notesPath), change)), unit: ['entry', 'entries'] as const }
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
      : (replaceSegment(start, raw, change.from.replace(/\.mdx$/, ''), name.replace(/\.mdx$/, ''), true) ??
        replaceSegment(start, raw, change.from, name, true));
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
  // Only `pages`: the folder keeps its title from the index page and stays
  // closed by default, as it was without a meta.yaml.
  return { writes: [{ path, content: pagesTemplate(names), baseMtime: null }], move: null, changes: [{ type: 'add', path }], open: null };
}

export type VisibilityRequest = { path: unknown; visible: unknown };

// Hides a page or folder from the site's sidebar (`visible: false` in its
// frontmatter or meta.yaml), or shows it again (the key comes out). A
// folder without meta.yaml gets one only to hide it. An unlisted node shown
// again is also added at the end of its folder's `pages`, as a create adds.
export async function planVisibility(root: string, tree: TreeFolder, request: VisibilityRequest): Promise<Plan> {
  const path = typeof request.path === 'string' ? request.path : '';
  if (path === '' || path === 'index.mdx') throw new HttpError(400, 'the root page and folder are always shown');
  if (typeof request.visible !== 'boolean') throw new HttpError(400, 'visible must be true or false');
  const visible = request.visible;
  const node = findNode(tree, (each) => (each.kind === 'page' || each.kind === 'folder') && each.path === path);
  if (node?.kind !== 'page' && node?.kind !== 'folder') throw new HttpError(404, `no such page or folder: ${NOTES_DIR}/${path}`);

  const writes: Write[] = [];
  const changes: TreeChange[] = [];
  const file = node.kind === 'folder' ? node.meta : node.path;
  if (file === null) {
    if (!visible) {
      const meta = inDir(path, 'meta.yaml');
      guarded(root, meta);
      writes.push({ path: meta, content: 'visible: false\n', baseMtime: null });
      changes.push({ type: 'add', path: meta });
    }
  } else {
    const current = await readText(root, file);
    const content = metaError(() => (node.kind === 'folder' ? writeMetaVisible : writePageVisible)(current.content, visible));
    if (content !== current.content) {
      writes.push({ path: file, content, baseMtime: current.mtimeMs });
      changes.push({ type: 'change', path: file, detail: visible ? 'removes visible: false' : 'visible: false' });
    }
  }
  if (visible && node.hidden === 'unlisted') {
    const parent = findFolder(tree, dirOf(path));
    if (parent.meta !== null) {
      const meta = await readText(root, parent.meta);
      const pages = metaError(() => readPages(meta.content)) ?? [];
      const slug = slugOf(path);
      const content = metaError(() => insertEntry(meta.content, slug, pages.length));
      if (content !== null) {
        writes.push({ path: parent.meta, content, baseMtime: meta.mtimeMs });
        changes.push({ type: 'change', path: parent.meta, detail: `adds "${slug}"` });
      }
    }
  }
  return { writes, move: null, changes, open: null };
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
// then each file is written atomically, at its place after the move. Not a
// transaction: if a write fails, the ones before it stay written and the
// error names the failed path.
export async function applyPlan(root: string, plan: Plan) {
  const check = async (path: string, baseMtime: number | null) => {
    const info = await statOrNull(guarded(root, path));
    if ((info?.mtimeMs ?? null) !== baseMtime) throw new HttpError(409, `${NOTES_DIR}/${path} changed on disk`);
    return info;
  };
  for (const write of plan.writes) await check(write.path, write.baseMtime);
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
}
