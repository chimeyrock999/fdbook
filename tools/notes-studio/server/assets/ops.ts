import { readFile, readdir, rename, rm, rmdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { slugify } from '../../src/slug.ts';
import { listEditableFiles, statOrNull } from '../files/store.ts';
import { HttpError } from '../http.ts';
import { ASSETS_DIR, extensionOf, NOTES_DIR, resolveWorktreePath } from '../security/paths.ts';
import { applyPlan } from '../tree/ops.ts';
import { findAssetRefs, rewriteAssetRefs, type AssetRef } from './refs.ts';

// Renaming and deleting files under public/notes, with every note that uses
// them kept in step. Like the page tree changes (server/tree/ops.ts), each
// is planned against the disk first, so a dry run can show it, then
// applied. Paths are worktree paths (`public/notes/…`, `content/notes/…`).

// Where a note uses an asset: a reference found in the parsed note, or, in
// a note that does not parse, a line that holds the file name (`unsure`).
// `length` is that of the path (or name) at `line` and `column`; `text` is
// the line.
export type AssetUsage = { note: string; line: number; column: number; length: number; text: string; unsure: boolean };
export type AssetInfo = { path: string; mtimeMs: number; usages: AssetUsage[] };

export type AssetChange =
  | { type: 'move'; path: string; to: string }
  | { type: 'change'; path: string; detail: string }
  | { type: 'delete'; path: string };

type Write = { path: string; content: string; baseMtime: number };

export type AssetPlan = {
  asset: { path: string; baseMtime: number };
  // Where the asset goes; null deletes it.
  to: string | null;
  // Notes to write, relative to content/notes as server/tree/ops.ts takes them.
  writes: Write[];
  changes: AssetChange[];
  usages: AssetUsage[];
};

const MAX_TEXT = 200;
const notesPath = (path: string) => path.slice(NOTES_DIR.length + 1);
const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? '' : 's'}`;

function lineText(lines: string[], line: number) {
  const text = (lines[line - 1] ?? '').trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

type Note = { path: string; content: string; mtimeMs: number };

async function readNotes(root: string): Promise<Note[]> {
  const files = (await listEditableFiles(root)).filter((file) => file.kind === 'note');
  const read = await Promise.all(
    files.map(async (file) => {
      const resolved = resolveWorktreePath(root, file.path);
      if (!resolved) return null;
      const info = await statOrNull(resolved.absolute);
      if (!info?.isFile()) return null;
      return { path: file.path, content: await readFile(resolved.absolute, 'utf8'), mtimeMs: info.mtimeMs };
    }),
  );
  return read.filter((note) => note !== null);
}

// The references found in each note, kept while its mtime stays: the
// assets list is asked again after every save, and most notes never change.
export type RefCache = Map<string, { mtimeMs: number; refs: AssetRef[] | null }>;

function refsOf(note: Note, cache?: RefCache) {
  const cached = cache?.get(note.path);
  if (cached?.mtimeMs === note.mtimeMs) return cached.refs;
  const refs = findAssetRefs(note.content, notesPath(note.path));
  cache?.set(note.path, { mtimeMs: note.mtimeMs, refs });
  return refs;
}

// Every usage in `note`, by asset. In a note that does not parse, each
// asset whose file name appears on a line counts as an unsure usage there.
function usagesIn(note: Note, assets: Iterable<string>, add: (asset: string, usage: AssetUsage) => void, cache?: RefCache) {
  const lines = note.content.split('\n');
  const refs = refsOf(note, cache);
  if (refs !== null) {
    for (const ref of refs) add(ref.asset, { note: note.path, line: ref.line, column: ref.column, length: ref.end - ref.start, text: lineText(lines, ref.line), unsure: false });
    return;
  }
  for (const asset of assets) {
    const name = baseOf(asset);
    const index = lines.findIndex((line) => line.includes(name) || line.includes(encodeURIComponent(name)));
    if (index === -1) continue;
    const at = lines[index].includes(name) ? lines[index].indexOf(name) : lines[index].indexOf(encodeURIComponent(name));
    const length = lines[index].includes(name) ? name.length : encodeURIComponent(name).length;
    add(asset, { note: note.path, line: index + 1, column: at + 1, length, text: lineText(lines, index + 1), unsure: true });
  }
}

// Every asset under public/notes with its usages, sorted by path. `cache`
// keeps each note's references between calls.
export async function listAssets(root: string, cache?: RefCache): Promise<AssetInfo[]> {
  const files = (await listEditableFiles(root)).filter((file) => file.kind === 'asset');
  const assets = new Map(files.map((file) => [file.path, { path: file.path, mtimeMs: file.mtimeMs, usages: [] as AssetUsage[] }]));
  const notes = await readNotes(root);
  const seen = new Set(notes.map((note) => note.path));
  for (const note of notes) {
    usagesIn(
      note,
      assets.keys(),
      (asset, usage) => {
        assets.get(asset)?.usages.push(usage);
      },
      cache,
    );
  }
  if (cache) for (const path of cache.keys()) if (!seen.has(path)) cache.delete(path);
  return [...assets.values()];
}

function guarded(root: string, path: unknown) {
  const resolved = typeof path === 'string' ? resolveWorktreePath(root, path) : null;
  if (resolved?.kind !== 'asset') throw new HttpError(403, `not an asset under ${ASSETS_DIR}: ${String(path)}`);
  return resolved.absolute;
}

async function checkAsset(root: string, path: string, baseMtime: unknown) {
  const info = await statOrNull(guarded(root, path));
  if (!info?.isFile()) throw new HttpError(404, `no such file: ${path}`);
  if (typeof baseMtime !== 'number') throw new HttpError(400, 'baseMtime must be the mtime the asset was listed with');
  if (info.mtimeMs !== baseMtime) throw new HttpError(409, `${path} changed on disk`);
  return info;
}

// The notes that use `path`, read once, with its usages.
async function usagesOf(root: string, path: string) {
  const name = baseOf(path);
  const notes = (await readNotes(root)).filter((note) => note.content.includes(name) || note.content.includes(encodeURIComponent(name)));
  const usages: AssetUsage[] = [];
  for (const note of notes) {
    usagesIn(note, [path], (asset, usage) => {
      if (asset === path) usages.push(usage);
    });
  }
  return { notes, usages };
}

function listed(usages: AssetUsage[]) {
  const notes = [...new Set(usages.map((usage) => usage.note))];
  return notes.length > 3 ? `${notes.slice(0, 3).join(', ')} and ${plural(notes.length - 3, 'more note')}` : notes.join(', ');
}

export type RenameRequest = { path: unknown; name: unknown; baseMtime: unknown };

// A new file name for the asset in its folder, extension kept, in the
// upload dialog's form (lowercase letters, digits and dashes), and every
// reference to it pointed at the new name.
export async function planAssetRename(root: string, request: RenameRequest): Promise<AssetPlan> {
  const path = typeof request.path === 'string' ? request.path : '';
  const info = await checkAsset(root, path, request.baseMtime);
  const { name } = request;
  if (typeof name !== 'string' || name === '' || slugify(name) !== name) {
    throw new HttpError(400, 'the name must be lowercase letters, digits and dashes');
  }
  const to = `${path.slice(0, path.lastIndexOf('/'))}/${name}.${extensionOf(path)}`;
  if (to === path) throw new HttpError(400, 'the name did not change');
  const target = await statOrNull(guarded(root, to));
  // A name that differs only in case is the same file on a case-insensitive disk.
  if (target && target.ino !== info.ino) throw new HttpError(409, `${to} already exists`);

  const { notes, usages } = await usagesOf(root, path);
  const unsure = usages.filter((usage) => usage.unsure);
  if (unsure.length > 0) throw new HttpError(409, `${listed(unsure)} does not parse and may use ${baseOf(path)}: fix it first`);
  const writes: Write[] = [];
  const changes: AssetChange[] = [{ type: 'move', path, to }];
  for (const note of notes) {
    const result = rewriteAssetRefs(note.content, notesPath(note.path), (asset) => (asset === path ? to : null));
    if (!result || result.count === 0) continue;
    writes.push({ path: notesPath(note.path), content: result.next, baseMtime: note.mtimeMs });
    changes.push({ type: 'change', path: note.path, detail: plural(result.count, 'reference') });
  }
  return { asset: { path, baseMtime: info.mtimeMs }, to, writes, changes, usages };
}

export type DeleteRequest = { path: unknown; baseMtime: unknown };

// Deletes an asset no note uses; refused (409) while any does.
export async function planAssetDelete(root: string, request: DeleteRequest): Promise<AssetPlan> {
  const path = typeof request.path === 'string' ? request.path : '';
  const info = await checkAsset(root, path, request.baseMtime);
  const { usages } = await usagesOf(root, path);
  if (usages.length > 0) throw new HttpError(409, `${listed(usages)} still ${usages.length === 1 ? 'uses' : 'use'} ${baseOf(path)}: remove the references first`);
  return { asset: { path, baseMtime: info.mtimeMs }, to: null, writes: [], changes: [{ type: 'delete', path }], usages };
}

// Removes the folders a delete left empty, up to public/notes.
async function pruneEmpty(root: string, dir: string) {
  const top = join(root, ASSETS_DIR);
  for (let current = dir; current.startsWith(`${top}/`); current = dirname(current)) {
    const entries = await readdir(current).catch(() => null);
    if (entries === null || entries.length > 0) return;
    await rmdir(current).catch(() => undefined);
  }
}

// Applies the plan: the asset and every note must still have the mtime it
// was planned from. The asset moves (or goes) first, so a refused change
// leaves everything as it was; then each note is written as page tree
// changes write them. Not a transaction: a write that fails leaves the ones
// before it written, and names the failed path.
export async function applyAssetPlan(root: string, plan: AssetPlan) {
  const from = guarded(root, plan.asset.path);
  const info = await statOrNull(from);
  if (info?.mtimeMs !== plan.asset.baseMtime) throw new HttpError(409, `${plan.asset.path} changed on disk`);
  for (const write of plan.writes) {
    const note = await stat(join(root, NOTES_DIR, write.path)).catch(() => null);
    if (note?.mtimeMs !== write.baseMtime) throw new HttpError(409, `${NOTES_DIR}/${write.path} changed on disk`);
  }
  if (plan.to === null) {
    await rm(from);
    await pruneEmpty(root, dirname(from));
    return;
  }
  const to = guarded(root, plan.to);
  const target = await statOrNull(to);
  if (target && target.ino !== info.ino) throw new HttpError(409, `${plan.to} already exists`);
  await rename(from, to);
  await applyPlan(root, { writes: plan.writes, move: null, changes: [], open: null });
}
