import { readFile } from 'node:fs/promises';
import { HttpError } from '../http.ts';
import { isTextPath, MAX_ASSET_BYTES } from '../security/asset-types.ts';
import { classifyPath, EDITABLE_AREAS, resolveWorktreePath } from '../security/paths.ts';
import { statOrNull } from '../files/store.ts';
import { assertWorktreeTop, runGit, runGitBytes } from './git.ts';
import { baseOf } from './history.ts';

// One side of a diff: the file's text, or only its size when it is not text
// (an image, a PDF) or too large to show.
export type DiffSide = { kind: 'text'; text: string; size: number } | { kind: 'binary'; size: number };
// What a file is in the change request against main: `same`, or
// modified, added, deleted, or renamed from `from`.
export type DiffStatus = 'same' | 'M' | 'A' | 'D' | 'R';
// `base` is the commit the change request left main at (the merge base),
// or null when there is no main to compare with: then nothing is before.
export type FileDiff = { path: string; from?: string; base: string | null; status: DiffStatus; before: DiffSide | null; after: DiffSide | null };

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const SHA = /^[0-9a-f]{40}$/;

// The commit the change request left main at: what main held when the work
// started, so commits main gained since are not shown as this work undoing them.
export async function mergeBase(root: string) {
  const ref = await baseOf(root);
  if (ref === null) return null;
  return runGit(root, ['merge-base', ref, 'HEAD']).then((sha) => sha.trim(), () => null);
}

// The file's size in commit `base`, or null when it has none there.
async function sizeAtBase(root: string, base: string, path: string) {
  const size = await runGit(root, ['cat-file', '-s', `${base}:${path}`]).then((out) => Number(out.trim()), () => null);
  return size !== null && Number.isFinite(size) ? size : null;
}

export const readBlob = (root: string, base: string, path: string) => runGitBytes(root, ['cat-file', 'blob', `${base}:${path}`], MAX_ASSET_BYTES + 1024);

// One side as commit `base` holds it: the text when it is text and small
// enough, else only the size, which git tells without reading the file.
export async function sideAtBase(root: string, base: string, path: string): Promise<DiffSide | null> {
  const size = await sizeAtBase(root, base, path);
  if (size === null) return null;
  if (!isTextPath(path) || size > MAX_TEXT_BYTES) return { kind: 'binary', size };
  return { kind: 'text', text: (await readBlob(root, base, path)).toString('utf8'), size };
}

// The worktree's side, read only when it is shown as text.
export async function sideOnDisk(absolute: string, path: string): Promise<DiffSide | null> {
  const info = await statOrNull(absolute);
  if (!info?.isFile()) return null;
  if (!isTextPath(path) || info.size > MAX_TEXT_BYTES) return { kind: 'binary', size: info.size };
  const data = await readFile(absolute);
  return { kind: 'text', text: data.toString('utf8'), size: data.length };
}

// A path the path policy allows and no link leads to.
export function checked(root: string, path: string) {
  const resolved = resolveWorktreePath(root, path);
  if (!resolved) throw new HttpError(403, `not an editable path: ${path}`);
  return resolved.absolute;
}

// Whether a binary side on disk holds what `base` has: git hashes it the
// way it hashed the commit's blob.
async function sameBlob(root: string, base: string, from: string, path: string) {
  const [then, now] = await Promise.all([
    runGit(root, ['rev-parse', '--verify', '--quiet', `${base}:${from}`]).catch(() => ''),
    runGit(root, ['hash-object', '--', path]),
  ]);
  return then.trim() !== '' && then.trim() === now.trim();
}

// The old name of `path` if the change request renamed it since `base`:
// git status names only renames against HEAD, so one already committed
// comes from comparing the worktree with the base. A file not yet known to
// git (a rename the Studio made, not committed) has none.
async function renamedFrom(root: string, base: string, path: string) {
  const output = await runGit(root, ['diff', '-z', '--name-status', '--find-renames', base, '--', ...EDITABLE_AREAS]);
  const entries = output.split('\0');
  for (let index = 0; index < entries.length; index += 1) {
    if (!entries[index].startsWith('R')) continue;
    const [old, now] = [entries[index + 1], entries[index + 2]];
    index += 2;
    if (now === path && classifyPath(old) !== null) return old;
  }
  return null;
}

// What `path` is now (on disk, committed or not) against what main held at
// the merge base. A rename reads main under the old name: `from`, or the
// one renamedFrom finds when main has nothing at `path`.
export async function loadDiff(root: string, path: string, given?: string): Promise<FileDiff> {
  const absolute = checked(root, path);
  if (given !== undefined) checked(root, given);
  await assertWorktreeTop(root);
  const base = await mergeBase(root);
  const [atBase, after] = await Promise.all([base === null ? null : sideAtBase(root, base, given ?? path), sideOnDisk(absolute, path)]);
  const found = base !== null && atBase === null && given === undefined ? await renamedFrom(root, base, path) : null;
  const from = given ?? found ?? undefined;
  const before = base !== null && found !== null ? await sideAtBase(root, base, found) : atBase;
  const old = from ?? path;
  if (before === null && after === null) throw new HttpError(404, `no such file on main or in the worktree: ${path}`);
  let status: DiffStatus;
  if (before === null) status = 'A';
  else if (after === null) status = 'D';
  else if (from !== undefined && from !== path) status = 'R';
  else if (before.kind === 'text' && after.kind === 'text') status = before.text === after.text ? 'same' : 'M';
  else status = before.size === after.size && base !== null && (await sameBlob(root, base, old, path)) ? 'same' : 'M';
  return { path, ...(from === undefined ? {} : { from }), base, status, before, after };
}

// The file as main held it at `base` (the sha a diff answered), else at the
// merge base now, for the before side of an image; 404 when it had none.
export async function loadBaseFile(root: string, path: string, base: string | null) {
  checked(root, path);
  await assertWorktreeTop(root);
  const at = base !== null && SHA.test(base) ? base : await mergeBase(root);
  if (at === null || (await sizeAtBase(root, at, path)) === null) throw new HttpError(404, `not on main: ${path}`);
  return readBlob(root, at, path);
}

// Every editable file the change request changed against main at the merge
// base, committed or not, new files git does not track yet included. Empty
// when there is no main to compare with.
export async function changedSinceBase(root: string): Promise<{ path: string; status: Exclude<DiffStatus, 'same'>; from?: string }[]> {
  await assertWorktreeTop(root);
  const base = await mergeBase(root);
  if (base === null) return [];
  const [diff, untracked] = await Promise.all([
    runGit(root, ['diff', '-z', '--name-status', '--find-renames', base, '--', ...EDITABLE_AREAS]),
    runGit(root, ['ls-files', '-z', '--others', '--exclude-standard', '--', ...EDITABLE_AREAS]),
  ]);
  const changed: { path: string; status: Exclude<DiffStatus, 'same'>; from?: string }[] = [];
  const entries = diff.split('\0');
  for (let index = 0; index < entries.length - 1; index += 1) {
    const code = entries[index][0];
    if (code === 'R') {
      const [from, path] = [entries[index + 1], entries[index + 2]];
      index += 2;
      if (classifyPath(path) !== null) changed.push({ path, status: 'R', from });
    } else if (code === 'M' || code === 'A' || code === 'D' || code === 'T') {
      const path = entries[index + 1];
      index += 1;
      if (classifyPath(path) !== null) changed.push({ path, status: code === 'T' ? 'M' : code });
    }
  }
  for (const path of untracked.split('\0')) if (path !== '' && classifyPath(path) !== null) changed.push({ path, status: 'A' });
  return changed.sort((a, b) => a.path.localeCompare(b.path));
}
