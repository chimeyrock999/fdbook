import type { Stats } from 'node:fs';
import { readFile, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { slugify } from '@fdbook/shared/slug.ts';
import { listEditableFiles, statOrNull, writeAtomic } from '#services/files/store.ts';
import { HttpError } from '#infra/http.ts';
import { DIAGRAM_SUFFIX } from '@fdbook/shared/asset-types.ts';
import { ASSETS_DIR, classifyPath, DIAGRAMS_DIR, extensionOf, NOTES_DIR, resolveWorktreePath } from '#infra/security/paths.ts';
import { findAssetRefs, rewriteAssetRefs, type AssetRef } from './refs.ts';

// Renaming and deleting files under public/notes, with every note that uses
// them kept in step. Like the page tree changes (services/tree/ops.ts), each
// is planned against the disk first, so a dry run can show it, then
// applied. Paths are worktree paths (`public/notes/…`, `content/notes/…`).

// Where a note uses an asset: a reference found in the parsed note, or
// `unsure`: a reference whose path could not be placed in the source, or,
// in a note that does not parse, a line that holds the file name.
// `length` is that of the path (or name) at `line` and `column`; `text` is
// the line.
export type AssetUsage = { note: string; line: number; column: number; length: number; text: string; unsure: boolean };
export type AssetInfo = { path: string; mtimeMs: number; size: number; usages: AssetUsage[] };

export type AssetChange =
  | { type: 'move'; path: string; to: string }
  | { type: 'change'; path: string; detail: string }
  | { type: 'delete'; path: string }
  // New content for the asset, at `to`: its own path, or the same name with
  // the new file's extension.
  | { type: 'replace'; path: string; to: string };

type Write = { path: string; content: string; baseMtime: number };

export type AssetPlan = {
  asset: { path: string; baseMtime: number };
  // Where the asset goes; null deletes it.
  to: string | null;
  writes: Write[];
  changes: AssetChange[];
  usages: AssetUsage[];
};

// Each note as last read: its references (null when it does not parse) and
// lines, kept while its mtime stays. The assets list is asked again after
// every save, and most notes never change, so most are not read again.
export type NoteScan = Map<string, { mtimeMs: number; refs: AssetRef[] | null; lines: string[] }>;

const MAX_TEXT = 200;
const notesPath = (path: string) => path.slice(NOTES_DIR.length + 1);
const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? '' : 's'}`;

function lineText(lines: string[], line: number) {
  const text = (lines[line - 1] ?? '').trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

function noteFile(root: string, path: string) {
  const resolved = resolveWorktreePath(root, path);
  return resolved?.kind === 'note' ? resolved.absolute : null;
}

// Brings `scan` up to date with the notes on disk: a note whose mtime moved
// is read and parsed again, a note that is gone is dropped. The mtime is
// the one listed before the read, so a save during the read shows as a
// newer mtime next time.
export async function scanNotes(root: string, scan: NoteScan) {
  const notes = (await listEditableFiles(root)).filter((file) => file.kind === 'note');
  const listed = new Set(notes.map((note) => note.path));
  for (const path of scan.keys()) if (!listed.has(path)) scan.delete(path);
  await Promise.all(
    notes.map(async (note) => {
      if (scan.get(note.path)?.mtimeMs === note.mtimeMs) return;
      const absolute = noteFile(root, note.path);
      const content = absolute === null ? null : await readFile(absolute, 'utf8').catch(() => null);
      if (content === null) {
        scan.delete(note.path);
        return;
      }
      scan.set(note.path, { mtimeMs: note.mtimeMs, refs: findAssetRefs(content, notesPath(note.path)), lines: content.split('\n') });
    }),
  );
  return scan;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Where a note that does not parse may use `asset`: the first line that
// holds its file name whole (`data.png` is not `ta.png`), as written or
// percent-encoded; for a diagram, the `src` a <Diagram> names it with.
function unsureUsage(note: string, lines: string[], asset: string): AssetUsage | null {
  const diagram = classifyPath(asset) === 'diagram';
  const name = diagram ? asset.slice(DIAGRAMS_DIR.length + 1, -DIAGRAM_SUFFIX.length) : baseOf(asset);
  // A file name may follow a folder. A diagram's src is the whole path (a
  // leading `/` allowed), so a folder before or after it makes another one.
  const before = diagram ? '(?<![\\w.%-])(?<![\\w.%-]/)' : '(?<![\\w.%-])';
  const after = diagram ? '(?![\\w/-])' : '(?![\\w-])';
  const pattern = new RegExp(`${before}(${escapeRegExp(name)}|${escapeRegExp(encodeURIComponent(name))})${after}`);
  for (const [index, line] of lines.entries()) {
    const match = pattern.exec(line);
    if (match) return { note, line: index + 1, column: match.index + 1, length: match[0].length, text: lineText(lines, index + 1), unsure: true };
  }
  return null;
}

// Every usage of the given assets, by asset, in note and line order.
export function usagesIn(scan: NoteScan, assets: Iterable<string>) {
  const usages = new Map<string, AssetUsage[]>();
  for (const asset of assets) usages.set(asset, []);
  for (const [note, { refs, lines }] of [...scan].sort(([a], [b]) => a.localeCompare(b))) {
    if (refs === null) {
      for (const [asset, list] of usages) {
        const usage = unsureUsage(note, lines, asset);
        if (usage) list.push(usage);
      }
      continue;
    }
    for (const ref of refs) {
      usages.get(ref.asset)?.push({ note, line: ref.line, column: ref.column, length: ref.end - ref.start, text: lineText(lines, ref.line), unsure: !ref.exact });
    }
  }
  return usages;
}

// Every asset under public/notes, then every diagram under diagrams/ (the
// Assets view lists both), with its usages, sorted by path. `scan` keeps
// what was read of the notes between calls.
export async function listAssets(root: string, scan: NoteScan = new Map()): Promise<AssetInfo[]> {
  const files = (await listEditableFiles(root)).filter((file) => file.kind === 'asset' || file.kind === 'diagram');
  const usages = usagesIn(await scanNotes(root, scan), files.map((file) => file.path));
  return files.map((file) => ({ path: file.path, mtimeMs: file.mtimeMs, size: file.size, usages: usages.get(file.path) ?? [] }));
}

function guarded(root: string, path: unknown) {
  const resolved = typeof path === 'string' ? resolveWorktreePath(root, path) : null;
  if (resolved?.kind !== 'asset') throw new HttpError(403, `not an asset under ${ASSETS_DIR}: ${String(path)}`);
  return resolved.absolute;
}

export async function checkAsset(root: string, path: string, baseMtime: unknown) {
  const info = await statOrNull(guarded(root, path));
  if (!info?.isFile()) throw new HttpError(404, `no such file: ${path}`);
  if (typeof baseMtime !== 'number' || !Number.isFinite(baseMtime)) throw new HttpError(400, 'baseMtime must be the mtime the asset was listed with');
  if (info.mtimeMs !== baseMtime) throw new HttpError(409, `${path} changed on disk`);
  return info;
}

export function listed(usages: AssetUsage[]) {
  const notes = [...new Set(usages.map((usage) => usage.note))];
  return notes.length > 3 ? `${notes.slice(0, 3).join(', ')} and ${plural(notes.length - 3, 'more note')}` : notes.join(', ');
}

export type RenameRequest = { path: unknown; name: unknown; baseMtime: unknown };

// A new file name for the asset in its folder, extension kept, in the
// upload dialog's form (lowercase letters, digits and dashes), and every
// reference to it pointed at the new name.
export async function planAssetRename(root: string, request: RenameRequest, scan: NoteScan = new Map()): Promise<AssetPlan> {
  const path = typeof request.path === 'string' ? request.path : '';
  const info = await checkAsset(root, path, request.baseMtime);
  const { name } = request;
  if (typeof name !== 'string' || name === '' || slugify(name) !== name) {
    throw new HttpError(400, 'the name must be lowercase letters, digits and dashes');
  }
  const to = `${path.slice(0, path.lastIndexOf('/'))}/${name}.${extensionOf(path)}`;
  if (to === path) throw new HttpError(400, 'the name did not change');
  return planMove(root, { path, info }, to, scan, { type: 'move', path, to });
}

// The asset going from `asset.path` to `to`, and every reference to it
// pointed there; `first` heads the changes. Rename uses it, and a replace
// that changes the extension.
export async function planMove(root: string, asset: { path: string; info: Stats }, to: string, scan: NoteScan, first: AssetChange): Promise<AssetPlan> {
  const { path, info } = asset;
  const target = await statOrNull(guarded(root, to));
  // A name that differs only in case is the same file on a case-insensitive disk.
  if (target && target.ino !== info.ino) throw new HttpError(409, `${to} already exists`);

  await scanNotes(root, scan);
  const usages = usagesIn(scan, [path]).get(path) ?? [];
  const unsure = usages.filter((usage) => usage.unsure);
  if (unsure.length > 0) {
    throw new HttpError(409, `${listed(unsure)} may use ${baseOf(path)} in a way the Studio cannot rewrite (the note does not parse, or the path is written with escapes it does not read): fix it first`);
  }
  const writes: Write[] = [];
  const changes: AssetChange[] = [first];
  for (const note of new Set(usages.map((usage) => usage.note))) {
    // The text the references were found in: read again, and parsed again
    // only if it changed since the scan.
    const absolute = noteFile(root, note);
    const before = absolute === null ? null : await statOrNull(absolute);
    if (absolute === null || !before) throw new HttpError(409, `${note} is gone`);
    const content = await readFile(absolute, 'utf8');
    const scanned = scan.get(note);
    const refs = scanned?.mtimeMs === before.mtimeMs ? scanned.refs : findAssetRefs(content, notesPath(note));
    const result = rewriteAssetRefs(content, notesPath(note), (asset) => (asset === path ? to : null), refs);
    if (!result || result.count === 0) continue;
    writes.push({ path: note, content: result.next, baseMtime: before.mtimeMs });
    changes.push({ type: 'change', path: note, detail: plural(result.count, 'reference') });
  }
  return { asset: { path, baseMtime: info.mtimeMs }, to, writes, changes, usages };
}

export type DeleteRequest = { path: unknown; baseMtime: unknown };

// Deletes an asset no note uses; refused (409) while any does.
export async function planAssetDelete(root: string, request: DeleteRequest, scan: NoteScan = new Map()): Promise<AssetPlan> {
  const path = typeof request.path === 'string' ? request.path : '';
  const info = await checkAsset(root, path, request.baseMtime);
  const usages = usagesIn(await scanNotes(root, scan), [path]).get(path) ?? [];
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

async function checkNote(root: string, write: Write) {
  const absolute = noteFile(root, write.path);
  const info = absolute === null ? null : await statOrNull(absolute);
  if (absolute === null || info?.mtimeMs !== write.baseMtime) throw new HttpError(409, `${write.path} changed on disk`);
  return { absolute, info };
}

// Applies the plan: the asset and every note must still have the mtime it
// was planned from, checked for all first and again before each write. The
// asset moves (or goes) first, then each note is written atomically. If the
// first note cannot be written, the asset moves back and nothing changed.
// Not a transaction past that: a later failure leaves the notes before it
// written, and the error says so. With `content` (a replace) the asset is
// written at `to` instead of moved there, and the old file goes once the
// notes point at the new one. Returns the asset's mtime after a write.
export async function applyAssetPlan(root: string, plan: AssetPlan, content?: Buffer): Promise<number | null> {
  const from = guarded(root, plan.asset.path);
  const info = await statOrNull(from);
  if (info?.mtimeMs !== plan.asset.baseMtime) throw new HttpError(409, `${plan.asset.path} changed on disk`);
  for (const write of plan.writes) await checkNote(root, write);
  if (plan.to === null) {
    await rm(from);
    await pruneEmpty(root, dirname(from));
    return null;
  }
  if (content !== undefined && plan.to === plan.asset.path) return writeAtomic(from, content, info.mode);
  const to = guarded(root, plan.to);
  const target = await statOrNull(to);
  if (target && target.ino !== info.ino) throw new HttpError(409, `${plan.to} already exists`);
  let mtimeMs: number | null = null;
  if (content === undefined) await rename(from, to);
  else mtimeMs = await writeAtomic(to, content, info.mode);
  let written = 0;
  for (const write of plan.writes) {
    try {
      const { absolute, info: note } = await checkNote(root, write);
      await writeAtomic(absolute, write.content, note.mode);
      written += 1;
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const why = error instanceof HttpError ? error.message : `could not write ${write.path}: ${(error as Error).message}`;
      if (written === 0) {
        await (content === undefined ? rename(to, from) : rm(to));
        throw new HttpError(status, `${why}; nothing was changed`);
      }
      if (content !== undefined) {
        throw new HttpError(status, `${why}; ${plan.to} is written and ${plural(written, 'note')} before it point there, while ${plan.asset.path} is still in place for the rest`);
      }
      throw new HttpError(status, `${why}; ${plan.asset.path} is already ${baseOf(plan.to)}, and ${plural(written, 'note')} before it point there`);
    }
  }
  if (content !== undefined) await rm(from);
  return mtimeMs;
}
