import { statOrNull, writeAtomic } from '../files/store.ts';
import { HttpError } from '../http.ts';
import { classifyPath } from '../security/paths.ts';
import { checked, readBlob, sideAtBase, sideOnDisk, type DiffSide } from './diff.ts';
import { assertWorktreeTop, runGit } from './git.ts';
import { baseOf } from './history.ts';

// One version of a page: a commit that changed it, with the path the page
// had there (`from` is the old name when the commit renamed it). A commit
// of the change request's own, not on main, is `inChangeRequest`.
export type PageVersion = { sha: string; date: string; author: string; message: string; path: string; status: 'A' | 'M' | 'R'; from?: string; inChangeRequest: boolean };
// `mtimeMs` is the page on disk as the history was read, for a restore to
// name; null when the page is gone from the worktree.
export type PageHistory = { path: string; mtimeMs: number | null; versions: PageVersion[] };
// A side of a comparison: a commit, or `now`, the page on disk.
export type VersionRef = { version: string; path: string };
// `from` → `to`; `from` null compares with nothing (the version alone).
export type Comparison = { path: string; from: VersionRef | null; to: VersionRef; before: DiffSide | null; after: DiffSide | null };

const LIMIT = 200;
const SHA = /^[0-9a-f]{40}$/;
const NOW = 'now';

const RECORD = '\x1e';
const FIELD = '\x1f';

type LoggedVersion = Omit<PageVersion, 'inChangeRequest'>;

// Reads `git log --follow --cc -z --format=<RECORD>%H<FIELD>%cI<FIELD>%an<FIELD>%s
// --name-status -- <path>`: one record per commit, its header, then the one
// file's status and path, or a rename's (or copy's) status, old and new
// path. A merge that changed the page against every parent (its own
// resolution, or two branches' edits) comes after an empty field, with one
// status letter per parent (`MM`); a merge that kept one parent's page has
// no file and is no version. A type change (T) is a change of content as
// far as the page goes.
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
    return [];
  });
}

// A note the path policy allows; a meta.yaml or an asset has no page history.
function notePath(root: string, path: string) {
  if (classifyPath(path) !== 'note') throw new HttpError(403, `not a page: ${path}`);
  return checked(root, path);
}

// The commits that changed the page on HEAD, newest first, following
// renames, with the merges whose page is none of their parents' (--cc).
// Topological order keeps a commit after those built on it, which commit
// dates alone do not when they tie.
async function logPage(root: string, path: string) {
  await assertWorktreeTop(root);
  const format = `--format=${RECORD}%H${FIELD}%cI${FIELD}%an${FIELD}%s`;
  return parsePageLog(await runGit(root, ['log', '--follow', '--cc', '--topo-order', '-z', format, '--name-status', `-n${String(LIMIT)}`, 'HEAD', '--', path]));
}

// The page's versions. A commit not on the base (origin/main) is the change
// request's own; main's worktree is at origin/main, so it has none. A page
// not committed yet (new, or renamed in the Studio) has no versions, only
// what is on disk; one on neither side is not found.
export async function loadPageHistory(root: string, path: string): Promise<PageHistory> {
  const absolute = notePath(root, path);
  const base = await baseOf(root);
  const [logged, own, info] = await Promise.all([
    logPage(root, path),
    base === null ? '' : runGit(root, ['rev-list', `${base}..HEAD`]),
    statOrNull(absolute),
  ]);
  const ours = new Set(own.split('\n').filter(Boolean));
  const mtimeMs = info?.isFile() ? info.mtimeMs : null;
  if (logged.length === 0 && mtimeMs === null) throw new HttpError(404, `no history for ${path}`);
  return { path, mtimeMs, versions: logged.map((version) => ({ ...version, inChangeRequest: ours.has(version.sha) })) };
}

const checkVersion = (version: unknown, what = 'a version') => {
  if (typeof version !== 'string' || !SHA.test(version)) throw new HttpError(400, `${what} is a full commit sha`);
  return version;
};

// A version the client named, as the page's log has it: the sha must be one
// of the page's, so the path read at it comes from git, not the client.
function versionIn(versions: LoggedVersion[], path: string, version: string) {
  const found = versions.find((each) => each.sha === version);
  if (found === undefined) throw new HttpError(404, `${version} is not a version of ${path}`);
  return found;
}

// Version `from` (or nothing) against version `to`; either may be `now`.
export async function comparePageVersions(root: string, path: string, from: string | null, to: string | null): Promise<Comparison> {
  const absolute = notePath(root, path);
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

// Writes the page as version `sha` held it over the page on disk, under its
// current name, and commits nothing. `mtimeMs` is the page as the client
// last read it: a page that changed since is not overwritten (409).
export async function restorePageVersion(root: string, { path, sha, mtimeMs }: { path: unknown; sha: unknown; mtimeMs: unknown }) {
  if (typeof path !== 'string') throw new HttpError(400, 'path must be a string');
  if (typeof mtimeMs !== 'number') throw new HttpError(400, 'mtimeMs must be a number');
  const absolute = notePath(root, path);
  const found = versionIn(await logPage(root, path), path, checkVersion(sha, 'sha'));
  const info = await statOrNull(absolute);
  if (!info?.isFile()) throw new HttpError(404, `the page is not in the worktree: ${path}`);
  if (info.mtimeMs !== mtimeMs) throw new HttpError(409, `${path} changed on disk since it was read`);
  const data = await readBlob(root, found.sha, found.path);
  return { path, mtimeMs: await writeAtomic(absolute, data, info.mode) };
}
