import { applyAssetPlan } from '../assets/ops.ts';
import { planAssetReplace } from '../assets/replace.ts';
import { findAssetSources } from '../assets/sources.ts';
import { statOrNull, writeAtomic } from '../files/store.ts';
import { HttpError } from '../http.ts';
import { classifyPath, extensionOf } from '../security/paths.ts';
import { checked, readBlob, sideAtBase, sideOnDisk, type DiffSide } from './diff.ts';
import { assertWorktreeTop, runGit } from './git.ts';
import { baseOf } from './history.ts';

// One version of a page: a commit that changed it, with the path the page
// had there (`from` is the old name when the commit renamed it). A commit
// of the change request's own, not on main, is `inChangeRequest`.
export type PageVersion = { sha: string; date: string; author: string; message: string; path: string; status: 'A' | 'M' | 'R'; from?: string; inChangeRequest: boolean };
// The commit that deleted a file the worktree no longer has.
export type DeletedIn = { sha: string; date: string; author: string; message: string };
// `mtimeMs` is the file on disk as the history was read, for a restore to
// name; null when the file is gone from the worktree. `deleted` is the
// commit that took it away, when one did. `generated`: a diagram source
// generates the asset, so a restore is refused, as a Replace is.
export type PageHistory = { path: string; mtimeMs: number | null; deleted: DeletedIn | null; generated: boolean; versions: PageVersion[] };
// A side of a comparison: a commit, or `now`, the page on disk.
export type VersionRef = { version: string; path: string };
// `from` → `to`; `from` null compares with nothing (the version alone).
export type Comparison = { path: string; from: VersionRef | null; to: VersionRef; before: DiffSide | null; after: DiffSide | null };

const LIMIT = 200;
const SHA = /^[0-9a-f]{40}$/;
const NOW = 'now';

const RECORD = '\x1e';
const FIELD = '\x1f';

// A commit of the log: a version, or (D) the commit that deleted the file.
type LoggedVersion = Omit<PageVersion, 'inChangeRequest' | 'status'> & { status: PageVersion['status'] | 'D' };

// Reads `git log --follow --cc -z --format=<RECORD>%H<FIELD>%cI<FIELD>%an<FIELD>%s
// --name-status -- <path>`: one record per commit, its header, then the one
// file's status and path, or a rename's (or copy's) status, old and new
// path. A merge that changed the page against every parent (its own
// resolution, or two branches' edits) comes after an empty field, with one
// status letter per parent (`MM`); a merge that kept one parent's page has
// no file and is no version. A type change (T) is a change of content as
// far as the page goes. A delete (D) is kept, for what it says about the
// file; it is no version.
export function parsePageLog(output: string): LoggedVersion[] {
  return output.split(RECORD).slice(1).flatMap((record): LoggedVersion[] => {
    const [header, ...fields] = record.split('\0');
    const start = fields.findIndex((field) => field.trim() !== '');
    if (start === -1) return [];
    const [code, ...paths] = fields.slice(start);
    const [sha, date, author, message] = header.split(FIELD);
    const status = code.trim().charAt(0);
    if (status === 'R' || status === 'C') return [{ sha, date, author, message, path: paths[1], status: 'R', from: paths[0] }];
    if (status === 'A') return [{ sha, date, author, message, path: paths[0], status }];
    if (status === 'M' || status === 'T') return [{ sha, date, author, message, path: paths[0], status: 'M' }];
    if (status === 'D') return [{ sha, date, author, message, path: paths[0], status }];
    return [];
  });
}

// The versions of a log, without the deletes.
const versionsOf = (logged: LoggedVersion[]) => logged.filter((version): version is LoggedVersion & { status: PageVersion['status'] } => version.status !== 'D');

// A note or an asset the path policy allows; a meta.yaml has no history.
function historyPath(root: string, path: string) {
  const kind = classifyPath(path);
  if (kind !== 'note' && kind !== 'asset') throw new HttpError(403, `no history for ${path}: only pages and assets have one`);
  return { kind, absolute: checked(root, path) };
}

// The commits that changed the page on HEAD, newest first, following
// renames, with the merges whose page is none of their parents' (--cc).
// Topological order keeps a commit after those built on it, which commit
// dates alone do not when they tie.
export async function logPage(root: string, path: string) {
  await assertWorktreeTop(root);
  const format = `--format=${RECORD}%H${FIELD}%cI${FIELD}%an${FIELD}%s`;
  return parsePageLog(await runGit(root, ['log', '--follow', '--cc', '--topo-order', '-z', format, '--name-status', `-n${String(LIMIT)}`, 'HEAD', '--', path]));
}

// The page's (or asset's) versions. A commit not on the base (origin/main)
// is the change request's own; main's worktree is at origin/main, so it has
// none. A file not committed yet (new, or renamed in the Studio) has no
// versions, only what is on disk; one on neither side is not found. One
// deleted on HEAD names the commit that deleted it.
export async function loadPageHistory(root: string, path: string): Promise<PageHistory> {
  const { kind, absolute } = historyPath(root, path);
  const base = await baseOf(root);
  const [logged, own, info, sources] = await Promise.all([
    logPage(root, path),
    base === null ? '' : runGit(root, ['rev-list', `${base}..HEAD`]),
    statOrNull(absolute),
    kind === 'asset' ? findAssetSources(root) : null,
  ]);
  const ours = new Set(own.split('\n').filter(Boolean));
  const mtimeMs = info?.isFile() ? info.mtimeMs : null;
  const versions = versionsOf(logged);
  if (versions.length === 0 && mtimeMs === null) throw new HttpError(404, `no history for ${path}`);
  const gone = mtimeMs === null && logged[0]?.status === 'D' ? logged[0] : null;
  return {
    path,
    mtimeMs,
    deleted: gone === null ? null : { sha: gone.sha, date: gone.date, author: gone.author, message: gone.message },
    generated: (sources?.get(path)?.length ?? 0) > 0,
    versions: versions.map((version) => ({ ...version, inChangeRequest: ours.has(version.sha) })),
  };
}

export const checkVersion = (version: unknown, what = 'a version') => {
  if (typeof version !== 'string' || !SHA.test(version)) throw new HttpError(400, `${what} is a full commit sha`);
  return version;
};

// A version the client named, as the page's log has it: the sha must be one
// of the page's, so the path read at it comes from git, not the client.
export function versionIn(logged: LoggedVersion[], path: string, version: string) {
  const found = versionsOf(logged).find((each) => each.sha === version);
  if (found === undefined) throw new HttpError(404, `${version} is not a version of ${path}`);
  return found;
}

// Version `from` (or nothing) against version `to`; either may be `now`.
export async function comparePageVersions(root: string, path: string, from: string | null, to: string | null): Promise<Comparison> {
  const { absolute } = historyPath(root, path);
  if (to === null) throw new HttpError(400, 'missing &to=');
  const wanted = [from, to].filter((version): version is string => version !== null && version !== NOW).map((version) => checkVersion(version));
  const versions = wanted.length === 0 ? [] : await logPage(root, path);
  const sideOf = async (version: string): Promise<{ ref: VersionRef; side: DiffSide | null }> => {
    if (version === NOW) return { ref: { version, path }, side: await sideOnDisk(absolute, path) };
    const found = versionIn(versions, path, version);
    return { ref: { version, path: found.path }, side: await sideAtBase(root, version, found.path) };
  };
  const [before, after] = await Promise.all([from === null ? null : sideOf(from), sideOf(to)]);
  return { path, from: before?.ref ?? null, to: after.ref, before: before?.side ?? null, after: after.side };
}

// Writes the file as version `sha` held it over the one on disk, under its
// current name, and commits nothing. `mtimeMs` is the file as the client
// last read it: one that changed since is not overwritten (409). An asset
// goes the way Replace writes one (server/assets/replace.ts): refused when a
// diagram source generates it, and a version with another extension takes
// that extension, every note's link following. `path` in the answer is
// where the file is now.
export async function restorePageVersion(root: string, { path, sha, mtimeMs }: { path: unknown; sha: unknown; mtimeMs: unknown }) {
  if (typeof path !== 'string') throw new HttpError(400, 'path must be a string');
  if (typeof mtimeMs !== 'number') throw new HttpError(400, 'mtimeMs must be a number');
  const { kind, absolute } = historyPath(root, path);
  const found = versionIn(await logPage(root, path), path, checkVersion(sha, 'sha'));
  const info = await statOrNull(absolute);
  if (!info?.isFile()) throw new HttpError(404, `not in the worktree: ${path}`);
  if (info.mtimeMs !== mtimeMs) throw new HttpError(409, `${path} changed on disk since it was read`);
  if (kind === 'asset') {
    const plan = await planAssetReplace(root, { path, extension: extensionOf(found.path), baseMtime: mtimeMs });
    const data = await readBlob(root, found.sha, found.path);
    const written = await applyAssetPlan(root, plan, data);
    return { path: plan.to ?? path, mtimeMs: written };
  }
  const data = await readBlob(root, found.sha, found.path);
  return { path, mtimeMs: await writeAtomic(absolute, data, info.mode) };
}
