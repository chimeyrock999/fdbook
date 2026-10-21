import { readFile } from 'node:fs/promises';
import { HttpError } from '../http.ts';
import { MAX_ASSET_BYTES } from '../security/asset-types.ts';
import { classifyPath, extensionOf, resolveWorktreePath } from '../security/paths.ts';
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
// Assets the diff reads as text; every other asset type is binary.
const TEXT_ASSETS = new Set(['svg', 'html']);
const SHA = /^[0-9a-f]{40}$/;

const isText = (path: string) => classifyPath(path) !== 'asset' || TEXT_ASSETS.has(extensionOf(path));

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

const readBlob = (root: string, base: string, path: string) => runGitBytes(root, ['cat-file', 'blob', `${base}:${path}`], MAX_ASSET_BYTES + 1024);

// One side as commit `base` holds it: the text when it is text and small
// enough, else only the size, which git tells without reading the file.
async function sideAtBase(root: string, base: string, path: string): Promise<DiffSide | null> {
  const size = await sizeAtBase(root, base, path);
  if (size === null) return null;
  if (!isText(path) || size > MAX_TEXT_BYTES) return { kind: 'binary', size };
  return { kind: 'text', text: (await readBlob(root, base, path)).toString('utf8'), size };
}

// The worktree's side, read only when it is shown as text.
async function sideOnDisk(absolute: string, path: string): Promise<DiffSide | null> {
  const info = await statOrNull(absolute);
  if (!info?.isFile()) return null;
  if (!isText(path) || info.size > MAX_TEXT_BYTES) return { kind: 'binary', size: info.size };
  const data = await readFile(absolute);
  return { kind: 'text', text: data.toString('utf8'), size: data.length };
}

// A path the path policy allows and no link leads to.
function checked(root: string, path: string) {
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

// What `path` is now (on disk, committed or not) against what main held at
// the merge base; a rename reads main under the old name, `from`.
export async function loadDiff(root: string, path: string, from?: string): Promise<FileDiff> {
  const absolute = checked(root, path);
  if (from !== undefined) checked(root, from);
  await assertWorktreeTop(root);
  const base = await mergeBase(root);
  const old = from ?? path;
  const [before, after] = await Promise.all([base === null ? null : sideAtBase(root, base, old), sideOnDisk(absolute, path)]);
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
