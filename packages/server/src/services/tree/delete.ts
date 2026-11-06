import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { visit } from 'unist-util-visit';
import { scanNotes, usagesIn, type NoteScan } from '#services/assets/ops.ts';
import { findAssetRefs } from '#services/assets/refs.ts';
import { listEditableFiles, type createKeyedLock } from '#services/files/store.ts';
import { HttpError } from '#infra/http.ts';
import { parseNote } from '#services/lint/lint.ts';
import { pageUrl, resolveHref } from '#services/lint/rules/links.ts';
import { ASSETS_DIR, NOTES_DIR, resolveWorktreePath } from '#infra/security/paths.ts';
import { entryReaches, loadTree, notesIndex } from './build.ts';
import { metaEditor } from './meta-file.ts';
import { applyPlan, dirOf, findNode, metaError, type Plan, type TreeChange } from './ops.ts';
import { CHANGED_SINCE, type TreeFolder } from '@fdbook/shared/tree.ts';

// Deleting a page (`x.mdx`), a folder page (`x/index.mdx`) or a folder (`x`,
// with every page in it) from the tree. Like the other tree changes it is
// planned first, so a dry run can show it: the files that go, the
// meta file entries that name them, the page's images under public/notes
// (deleted when no other note uses them, kept otherwise) and the notes that
// still link to what goes. The dry run's `base` names every file it read at
// the mtime it read it; the delete sends it back and is refused (409) when
// anything changed since, so it deletes only what the person saw.

// A note that still links to what is deleted: its path (relative to
// content/notes), the line, and the link as written.
export type IncomingLink = { note: string; line: number; href: string };

export type DeleteAnswer = { changes: TreeChange[]; open: null; base: string; links: IncomingLink[]; deleted: string[] };

type Target = { kind: 'page' | 'folder-page' | 'folder'; path: string };
type Where = ReturnType<typeof notesIndex>;

const withoutMdx = (path: string) => path.replace(/\.mdx$/, '');
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const notesPath = (path: string) => path.slice(NOTES_DIR.length + 1);

function targetOf(root: string, tree: TreeFolder, path: unknown): Target {
  if (typeof path !== 'string') throw new HttpError(400, 'path must be a page or folder path');
  if (path === '' || path === 'index.mdx') throw new HttpError(400, 'the root page and folder cannot be deleted');
  const checked = path.endsWith('.mdx') ? path : `${path}/meta.yaml`;
  if (!resolveWorktreePath(root, `${NOTES_DIR}/${checked}`)) {
    throw new HttpError(403, `not an editable path: ${NOTES_DIR}/${path}`);
  }
  if (path.endsWith('/index.mdx')) {
    // Its folder's own page, or, when the folder's meta file lists `index`, a child of it.
    const folder = findNode(tree, (node) => node.kind === 'folder' && node.path === dirOf(path));
    if (folder?.kind === 'folder' && (folder.index === path || folder.children.some((child) => child.kind === 'page' && child.path === path))) return { kind: 'folder-page', path };
  } else if (path.endsWith('.mdx')) {
    if (findNode(tree, (node) => node.kind === 'page' && node.path === path)) return { kind: 'page', path };
  } else if (findNode(tree, (node) => node.kind === 'folder' && node.path === path)) {
    return { kind: 'folder', path };
  }
  throw new HttpError(404, `no such page or folder: ${NOTES_DIR}/${path}`);
}

// Whether a delete takes out the entry of the meta file in `dir`: it
// reached a folder or page before (`before`) and reaches none once the
// delete is done (`after`). An entry `x` for a page `x.mdx` next to a folder
// `x/` keeps reaching the folder, so it stays; one that reached nothing
// already is not the delete's to remove.
function goesWith(before: Where, after: Where, dir: string, value: unknown) {
  return typeof value === 'string' && entryReaches(before, dir, value) === true && entryReaches(after, dir, value) === false;
}

// The images that go with the target: a page's folder under public/notes,
// a folder page's own files there (its children's folders stay), all of a
// folder's. A page `x.mdx` next to a folder `x/` shares that folder with the
// folder's pages' images: then only its own files there.
function imageMatch(target: Target, folders: ReadonlySet<string>) {
  const own = target.kind === 'folder-page' ? dirOf(target.path) : target.kind === 'page' ? withoutMdx(target.path) : target.path;
  const dir = `${ASSETS_DIR}/${own}/`;
  const flat = target.kind === 'folder-page' || (target.kind === 'page' && folders.has(own));
  return (path: string) => path.startsWith(dir) && (!flat || !path.slice(dir.length).includes('/'));
}

// Every link in the notes that stay that reaches a page that goes: by its
// file (`./x.mdx`) or its URL, a folder's URL or one under it included.
function incomingLinks(source: string, from: string, target: Target, pages: ReadonlySet<string>, gone: ReadonlySet<string>): IncomingLink[] {
  const urls = new Set([...gone].map(pageUrl));
  const folderUrl = target.kind === 'folder' ? pageUrl(`${target.path}/index.mdx`) : null;
  const found: IncomingLink[] = [];
  let tree;
  try {
    tree = parseNote(source);
  } catch {
    return found;
  }
  visit(tree, (node) => {
    if (node.type !== 'link' && node.type !== 'definition') return;
    let resolved;
    try {
      resolved = resolveHref(node.url, from, pages);
    } catch {
      return;
    }
    if (resolved === null || 'missing' in resolved) return;
    const hit = 'page' in resolved
      ? gone.has(resolved.page)
      : urls.has(resolved.url) || (folderUrl !== null && (resolved.url === folderUrl || resolved.url.startsWith(`${folderUrl}/`)));
    if (hit) found.push({ note: from, line: node.position?.start.line ?? 0, href: node.url });
  });
  return found;
}

// Every file the plan reads, at the mtime it read it.
function baseOf(plan: Plan) {
  const seen = [...plan.writes.map((write) => `${NOTES_DIR}/${write.path}\0${String(write.baseMtime)}`), ...(plan.deletes ?? []).map((file) => `${file.path}\0${String(file.baseMtime)}`)].sort();
  return createHash('sha256').update(seen.join('\n')).digest('hex').slice(0, 24);
}

export async function planDelete(root: string, tree: TreeFolder, request: { path: unknown }): Promise<Plan & DeleteAnswer> {
  const target = targetOf(root, tree, request.path);
  const all = await listEditableFiles(root);
  const inNotes = all.filter((file) => file.kind === 'note' || file.kind === 'meta');
  const goes = target.kind === 'folder'
    ? inNotes.filter((file) => notesPath(file.path).startsWith(`${target.path}/`))
    : inNotes.filter((file) => notesPath(file.path) === target.path);
  if (goes.length === 0) throw new HttpError(404, `no such page or folder: ${NOTES_DIR}/${target.path}`);
  const goneFiles = new Set(goes.map((file) => file.path));
  const gone = new Set(goes.filter((file) => file.kind === 'note').map((file) => notesPath(file.path)));

  const left = inNotes.filter((file) => !goneFiles.has(file.path)).map((file) => notesPath(file.path));
  // An entry goes when it reaches nothing once the files are gone: the
  // target's, and a folder the delete leaves empty (it goes too).
  const before = notesIndex(inNotes.map((file) => notesPath(file.path)));
  const after = notesIndex(left);
  const writes: Plan['writes'] = [];
  const changes: TreeChange[] = goes.map((file) => ({ type: 'delete', path: notesPath(file.path) }));
  const links: IncomingLink[] = [];
  const pages = new Set(inNotes.filter((file) => file.kind === 'note').map((file) => notesPath(file.path)));
  // Every file that stays is read once, at once; the notes' asset
  // references go to the usage scan below, so it reads none again.
  const read = await Promise.all(inNotes.filter((file) => !goneFiles.has(file.path)).map(async (file) => {
    const absolute = resolveWorktreePath(root, file.path)?.absolute;
    return absolute === undefined ? null : { file, content: await readFile(absolute, 'utf8') };
  }));
  const scan: NoteScan = new Map();
  // A note that does not hold the name cannot link to it by file or URL,
  // except a folder page, which `..` and `.` reach too.
  const name = target.kind === 'folder-page' ? null : nameOf(withoutMdx(target.path));
  for (const { file, content } of read.filter((each) => each !== null)) {
    const path = notesPath(file.path);
    if (file.kind === 'meta') {
      const dir = dirOf(path);
      const edit = metaEditor(path);
      const listed = metaError(() => edit.readPages(content)) ?? [];
      const removed = listed.filter((value) => goesWith(before, after, dir, value));
      if (removed.length === 0) continue;
      writes.push({ path, content: metaError(() => edit.keepEntries(content, (value) => !goesWith(before, after, dir, value))), baseMtime: file.mtimeMs });
      changes.push({ type: 'change', path, detail: `removes ${removed.map((value) => `"${String(value)}"`).join(', ')}` });
      continue;
    }
    scan.set(file.path, { mtimeMs: file.mtimeMs, refs: findAssetRefs(content, path), lines: content.split('\n') });
    if (name === null || content.includes(name)) links.push(...incomingLinks(content, path, target, pages, gone));
  }

  // Images no note that stays uses go; the others stay, and say who uses them.
  const folders = new Set(left.map(dirOf));
  const images = all.filter((file) => file.kind === 'asset' && imageMatch(target, folders)(file.path));
  const usages = usagesIn(await scanNotes(root, scan), images.map((file) => file.path));
  const deletes = goes.map((file) => ({ path: file.path, baseMtime: file.mtimeMs }));
  for (const image of images) {
    const users = [...new Set((usages.get(image.path) ?? []).map((usage) => usage.note).filter((note) => !goneFiles.has(note)))];
    if (users.length > 0) changes.push({ type: 'keep', path: image.path, detail: `used by ${users.map(notesPath).join(', ')}` });
    else {
      deletes.push({ path: image.path, baseMtime: image.mtimeMs });
      changes.push({ type: 'delete', path: image.path });
    }
  }
  const plan: Plan = { writes, deletes, move: null, changes, open: null };
  return { ...plan, open: null, base: baseOf(plan), links: links.sort((a, b) => a.note.localeCompare(b.note) || a.line - b.line), deleted: [...gone].sort() };
}

// One delete, from the tree API or an accepted delete proposal: with
// `dryRun` only the plan; otherwise, under the notes lock, planned again
// from the disk and written when `base` is still the dry run's.
// `onDeleted` is told the notes that went (relative to content/notes).
export async function runDelete(
  root: string,
  lock: ReturnType<typeof createKeyedLock>,
  { path, base, dryRun }: { path: unknown; base?: unknown; dryRun?: boolean },
  onDeleted?: (target: string, notes: string[]) => Promise<void> | void,
): Promise<DeleteAnswer> {
  const answer = ({ changes, base: planned, links, deleted }: DeleteAnswer): DeleteAnswer => ({ changes, open: null, base: planned, links, deleted });
  if (dryRun === true) return answer(await planDelete(root, await loadTree(root), { path }));
  if (typeof base !== 'string') throw new HttpError(400, 'base must be the one a dry run of this delete answered');
  const done = await lock('notes', async () => {
    const plan = await planDelete(root, await loadTree(root), { path });
    if (plan.base !== base) throw new HttpError(409, CHANGED_SINCE);
    await applyPlan(root, plan);
    return answer(plan);
  });
  // The files are gone: what the proposals make of it cannot undo that, so
  // a failure there is logged, not answered as a failed delete.
  try {
    await onDeleted?.(path as string, done.deleted);
  } catch (error) {
    console.error(`after deleting ${String(path)}:`, error);
  }
  return done;
}
