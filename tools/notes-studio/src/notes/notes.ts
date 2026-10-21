import { classifyPath } from '../../server/security/asset-types';

export const NOTES_PREFIX = 'content/notes/';

// The file API speaks worktree paths, the sync socket paths inside content/notes.
export const syncPath = (path: string) => path.slice(NOTES_PREFIX.length);

// The open note (a sync path) while it has edits not on disk yet, from the
// last autosave status the editor reported, or null. The editor reports a
// status only when it changes, and starts at 'synced': a note that has
// reported nothing yet has nothing unsaved.
export function unsavedNote(active: string | null, saved: { path: string; status: string } | null): string | null {
  return active !== null && saved?.path === active && saved.status !== 'synced' ? syncPath(active) : null;
}

const isNote = (path: string) => path.startsWith(NOTES_PREFIX) && path.endsWith('.mdx');

// The note to open from `?path=`, if it names a note.
export function noteFromUrl(search: string): string | null {
  const path = new URLSearchParams(search).get('path');
  return path !== null && isNote(path) ? path : null;
}

// What the main pane shows: a note, an asset, or a file's diff against main
// (renamed `from` an old path), by worktree path.
export type Page = { kind: 'note' | 'asset'; path: string } | { kind: 'diff'; path: string; from?: string };

// The page to open from the URL: `?path=` names a note, `?asset=` a file
// under public/notes, `?diff=` (with `&from=` for a rename) any file the
// Studio may touch. The server's own lexical check, so the page opens only
// what it serves.
export function pageFromUrl(search: string): Page | null {
  const note = noteFromUrl(search);
  if (note !== null) return { kind: 'note', path: note };
  const params = new URLSearchParams(search);
  const asset = params.get('asset');
  if (asset !== null && classifyPath(asset) === 'asset') return { kind: 'asset', path: asset };
  const diff = params.get('diff');
  if (diff === null || classifyPath(diff) === null) return null;
  const from = params.get('from');
  return from !== null && classifyPath(from) !== null ? { kind: 'diff', path: diff, from } : { kind: 'diff', path: diff };
}

// The query that opens `page`, the inverse of pageFromUrl.
export function pageQuery(page: Page) {
  if (page.kind !== 'diff') return `?${page.kind === 'note' ? 'path' : 'asset'}=${encodeURIComponent(page.path)}`;
  return `?${new URLSearchParams({ diff: page.path, ...(page.from === undefined ? {} : { from: page.from }) }).toString()}`;
}

// The note's page on the site, as fumadocs slugs it under `docsRoute`
// (lib/shared.ts, which reads process.env and so is not imported here): an
// `index` names its folder and a `(group)` folder adds no segment.
export function noteRoute(path: string) {
  const segments = syncPath(path).replace(/\.mdx$/, '').split('/');
  if (segments.at(-1) === 'index') segments.pop();
  const slugs = segments.filter((segment) => !/^\(.+\)$/.test(segment));
  return ['/notes', ...slugs.map(encodeURIComponent)].join('/');
}

// The site's dev server (`npm run dev` at the repo root) unless
// STUDIO_SITE_URL names another.
export function siteUrlFrom(configured: string | undefined) {
  const url = configured?.trim() ?? '';
  return url === '' ? 'http://localhost:3000' : url;
}
