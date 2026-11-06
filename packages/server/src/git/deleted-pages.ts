import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { findBlock } from '@fdbook/shared/frontmatter-block.ts';
import { statOrNull } from '#files/store.ts';
import { HttpError } from '#http.ts';
import { classifyPath, NOTES_DIR } from '#security/paths.ts';
import { insertEntry, keepEntries, MetaEditError, readPages } from '#tree/meta-edit.ts';
import { applyPlan, type Plan } from '#tree/ops.ts';
import { checked, readBlob } from './diff.ts';
import { assertWorktreeTop, runGit } from './git.ts';
import { checkVersion, logPage, versionIn } from './page-history.ts';

// Pages deleted on HEAD (#114), and bringing one back into the change
// request: the page as a version of it held it, the folders deleted with it,
// and its entry in the folder's meta.yaml.

// A page the worktree no longer has, with the commit that deleted it.
// `folderGone`: its folder went too. `committed: false`: a delete not
// committed yet, and `sha` the last commit that has the page (its version
// to restore).
export type DeletedPage = { path: string; title: string; sha: string; date: string; author: string; message: string; folderGone: boolean; committed: boolean };
// What a restore writes, by worktree path; `open` is the restored page.
export type DeletedRestore = { path: string; open: string; changes: { type: 'add' | 'change'; path: string; detail?: string }[] };

const LIMIT = 200;
const RECORD = '\x1e';
const FIELD = '\x1f';
const PREFIX = `${NOTES_DIR}/`;

type Deletion = { sha: string; date: string; author: string; message: string; paths: string[] };

// Reads `git log --diff-filter=D --name-only -z --format=<RECORD>%H<FIELD>…`:
// one record per commit, its header, then the files it deleted.
export function parseDeletions(output: string): Deletion[] {
  return output.split(RECORD).slice(1).map((record) => {
    const [header, ...paths] = record.split('\0');
    const [sha, date, author, message] = header.split(FIELD);
    return { sha, date, author, message, paths: paths.map((path) => path.trim()).filter(Boolean) };
  });
}

// The title in a page's frontmatter, else its file name.
export function titleOf(source: string, path: string) {
  const block = findBlock(source);
  let data: unknown = null;
  try {
    data = block === null ? null : parse(block.yaml);
  } catch {
    // no title to read
  }
  const title = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).title : undefined;
  return typeof title === 'string' && title.trim() !== '' ? title : path.slice(path.lastIndexOf('/') + 1).replace(/\.mdx$/, '');
}

// Whether the worktree has folder `path` (a worktree path from git's log).
const hasFolder = async (root: string, path: string) => (await statOrNull(join(root, path)))?.isDirectory() === true;

// The pages HEAD has that the worktree deleted, not committed yet. A page
// the Studio renamed shows as a delete and an untracked file: git tells it
// apart (-M) in a scratch index holding the worktree's notes as they are,
// so the real index is never touched.
export async function uncommittedDeletes(root: string): Promise<string[]> {
  // No HEAD yet: nothing was committed to delete.
  if ((await runGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(() => '')).trim() === '') return [];
  const dir = await mkdtemp(join(tmpdir(), 'studio-deleted-'));
  const env = { GIT_INDEX_FILE: join(dir, 'index') };
  try {
    await runGit(root, ['read-tree', 'HEAD'], env);
    await runGit(root, ['add', '-A', '--', NOTES_DIR], env);
    const output = await runGit(root, ['diff', '--cached', '-M', '--name-only', '-z', '--diff-filter=D', 'HEAD', '--', NOTES_DIR], env);
    return output.split('\0').filter((path) => path !== '' && classifyPath(path) === 'note');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// The pages deleted on HEAD, newest delete first: each page once, at its
// last delete, and none the worktree has again. A rename is no delete (-M).
// Deletes not committed yet come first.
export async function loadDeletedPages(root: string): Promise<{ pages: DeletedPage[] }> {
  await assertWorktreeTop(root);
  const format = `--format=${RECORD}%H${FIELD}%cI${FIELD}%an${FIELD}%s`;
  const [output, pending] = await Promise.all([
    runGit(root, ['log', '-M', '--diff-filter=D', '--name-only', '-z', format, 'HEAD', '--', NOTES_DIR]),
    uncommittedDeletes(root),
  ]);
  const seen = new Set<string>();
  const found: (Omit<Deletion, 'paths'> & { path: string; committed: boolean })[] = [];
  // The last commit that has each page: what a restore brings back.
  const lastCommits = await Promise.all(pending.map(async (path) => ({ path, commit: parseDeletions(await runGit(root, ['log', '-1', '-z', format, 'HEAD', '--', path])).at(0) })));
  for (const { path, commit } of lastCommits) {
    if (commit === undefined) continue;
    seen.add(path);
    found.push({ sha: commit.sha, date: commit.date, author: commit.author, message: commit.message, path, committed: false });
  }
  for (const { paths, ...commit } of parseDeletions(output)) {
    for (const path of paths) {
      if (seen.has(path) || classifyPath(path) !== 'note') continue;
      seen.add(path);
      found.push({ ...commit, path, committed: true });
    }
  }
  const gone = await Promise.all(found.map(async (page) => ((await statOrNull(checked(root, page.path))) === null ? page : null)));
  // Titles are read from git one page at a time: only for the pages shown.
  const pages = await Promise.all(gone.filter((page) => page !== null).slice(0, LIMIT).map(async (page): Promise<DeletedPage> => {
    const folder = page.path.slice(0, page.path.lastIndexOf('/'));
    const source = await readBlob(root, page.committed ? `${page.sha}^` : page.sha, page.path).then((data) => data.toString('utf8'), () => '');
    return { ...page, title: titleOf(source, page.path), folderGone: !(await hasFolder(root, folder)) };
  }));
  return { pages };
}

// The text of `path` in commit `ref`, or null when it has none there.
const textAt = (root: string, ref: string, path: string) => readBlob(root, ref, path).then((data) => data.toString('utf8'), () => null);

// The entry a meta.yaml lists a page or folder by: `slug`, also as `!slug`
// or `...slug`; null for a separator, a link or `...`.
function slugOfEntry(value: unknown) {
  if (typeof value !== 'string' || value.startsWith('---') || value.startsWith('[')) return null;
  const slug = value.replace(/^(!|\.\.\.)/, '');
  return slug === '' || slug === 'z...a' || value === '...' ? null : slug;
}

// Where `slug` goes in `pages` (the folder's list now): after the entry
// before it in `before` (the list when it was deleted) that is still there,
// first when none is, and last when `before` did not list it.
export function placeOf(pages: unknown[], before: unknown[] | null, slug: string) {
  const at = before?.indexOf(slug) ?? -1;
  if (at === -1) return pages.length;
  for (let index = at - 1; index >= 0; index -= 1) {
    const found = pages.indexOf(before?.[index]);
    if (found !== -1) return found + 1;
  }
  return 0;
}

function metaError<T>(task: () => T): T {
  try {
    return task();
  } catch (error) {
    if (error instanceof MetaEditError) throw new HttpError(409, error.message);
    throw error;
  }
}

// Whether the meta.yaml above showed `slug` before the delete: it listed
// it, showed every page by itself (`...`), had no `pages` list, or there
// was none. One that listed others but not this one kept it out of the
// sidebar, and the restore keeps it out too.
export function wasShown(before: unknown[] | null, slug: string) {
  return before === null || before.some((item) => item === '...' || item === 'z...a' || slugOfEntry(item) === slug);
}

// Plans bringing back page `path` as version `sha` held it. Folders deleted
// with it come back too, as the commit before the delete held them: each
// one's index.mdx, and its meta.yaml listing only what comes back (`index`
// too, when it listed its folder page: a listed index is a child of the
// folder, not the folder's own page). The topmost thing restored (the page,
// or its topmost folder) goes back into the meta.yaml of the folder above,
// where it was, unless that list shows everything by itself (`...`) or did
// not list it before the delete.
async function planRestore(root: string, path: string, sha: string): Promise<Plan & { open: string }> {
  const logged = await logPage(root, path);
  const found = versionIn(logged, path, sha);
  const deletion = logged[0]?.status === 'D' ? logged[0].sha : null;
  // What the folders were when the page went; HEAD for a delete not committed.
  const before = deletion === null ? 'HEAD' : `${deletion}^`;
  const notePath = path.slice(PREFIX.length);
  const segments = notePath.split('/');
  const slug = segments.at(-1)?.replace(/\.mdx$/, '') ?? '';
  const folders = segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
  let missing = folders.length;
  for (const [index, folder] of folders.entries()) {
    if (!(await hasFolder(root, `${PREFIX}${folder}`))) {
      missing = index;
      break;
    }
  }

  const writes: Plan['writes'] = [{ path: notePath, content: (await readBlob(root, found.sha, found.path)).toString('utf8'), baseMtime: null }];
  for (const [index, folder] of folders.slice(missing).entries()) {
    const child = folders[missing + index + 1]?.slice(folder.length + 1) ?? slug;
    const folderPage = `${folder}/index.mdx`;
    const page = folderPage === notePath ? null : await textAt(root, before, `${PREFIX}${folderPage}`);
    const kept = new Set([child, ...(page !== null || folderPage === notePath ? ['index'] : [])]);
    const meta = await textAt(root, before, `${PREFIX}${folder}/meta.yaml`);
    if (meta !== null) {
      const content = metaError(() => keepEntries(meta, (value) => {
        const entry = slugOfEntry(value);
        return entry === null || kept.has(entry);
      }));
      writes.push({ path: `${folder}/meta.yaml`, content, baseMtime: null });
    }
    if (page !== null) writes.push({ path: folderPage, content: page, baseMtime: null });
  }

  // The folder above what comes back, and the entry that names it there.
  const parent = missing === 0 ? '' : folders[missing - 1];
  const top = missing < folders.length ? folders[missing].slice(parent === '' ? 0 : parent.length + 1) : slug === 'index' ? null : slug;
  const changes: Plan['changes'] = writes.map((write) => ({ type: 'add', path: write.path }));
  const metaPath = parent === '' ? 'meta.yaml' : `${parent}/meta.yaml`;
  const absolute = checked(root, `${PREFIX}${metaPath}`);
  const current = top === null ? null : await statOrNull(absolute);
  if (top !== null && current?.isFile()) {
    const text = await readFile(absolute, 'utf8');
    const pages = metaError(() => readPages(text));
    const then = await textAt(root, before, `${PREFIX}${metaPath}`);
    const old = then === null ? null : metaError(() => readPages(then));
    if (pages && wasShown(old, top) && !pages.some((item) => item === '...' || item === 'z...a') && !pages.some((item) => slugOfEntry(item) === top)) {
      const content = metaError(() => insertEntry(text, top, placeOf(pages, old, top)));
      if (content !== null) {
        writes.push({ path: metaPath, content, baseMtime: current.mtimeMs });
        changes.push({ type: 'change', path: metaPath, detail: `adds "${top}"` });
      }
    }
  }
  return { writes, move: null, changes, open: notePath };
}

// Brings back page `path` as version `sha` of it held it, uncommitted (or,
// with `dryRun`, only says what that writes). Refused while the worktree
// has a file at `path`: then the page's own history restores it.
export async function restoreDeletedPage(root: string, { path, sha, dryRun }: { path: unknown; sha: unknown; dryRun?: unknown }): Promise<DeletedRestore> {
  if (typeof path !== 'string') throw new HttpError(400, 'path must be a string');
  if (classifyPath(path) !== 'note') throw new HttpError(403, `not a page: ${path}`);
  if (await statOrNull(checked(root, path))) throw new HttpError(409, `${path} is in the worktree: restore it from its history`);
  await assertWorktreeTop(root);
  const plan = await planRestore(root, path, checkVersion(sha, 'sha'));
  if (dryRun !== true) await applyPlan(root, plan);
  return {
    path,
    open: `${PREFIX}${plan.open}`,
    changes: plan.changes.map((change) => ({ ...change, path: `${PREFIX}${change.path}` })) as DeletedRestore['changes'],
  };
}
