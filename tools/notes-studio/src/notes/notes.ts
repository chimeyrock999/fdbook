import { classifyPath } from '../../server/security/asset-types';
import { CURRENT_CR } from '../api/workspace';

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

// What the main pane shows: a note or an asset, by worktree path, a file's
// diff against main (renamed `from` an old path), or the list of change
// requests.
export type Page = { kind: 'note' | 'asset'; path: string } | { kind: 'diff'; path: string; from?: string } | { kind: 'crs' };

// The page to open from the URL: `?path=` names a note, `?asset=` a file
// under public/notes, `?diff=` (with `&from=` for a rename) any file the
// Studio may touch, `?view=crs` the change requests. Paths take the
// server's own lexical check, so the page opens only what it serves.
export function pageFromUrl(search: string): Page | null {
  const note = noteFromUrl(search);
  if (note !== null) return { kind: 'note', path: note };
  const params = new URLSearchParams(search);
  if (params.get('view') === 'crs') return { kind: 'crs' };
  const asset = params.get('asset');
  if (asset !== null && classifyPath(asset) === 'asset') return { kind: 'asset', path: asset };
  const diff = params.get('diff');
  if (diff === null || classifyPath(diff) === null) return null;
  const from = params.get('from');
  return from !== null && classifyPath(from) !== null ? { kind: 'diff', path: diff, from } : { kind: 'diff', path: diff };
}

// The query that opens `page` in change request `cr` (null: main), the
// inverse of pageFromUrl and crFromSearch.
export function pageQuery(page: Page | null, cr: string | null = CURRENT_CR) {
  const parts = cr === null ? [] : [`cr=${cr}`];
  if (page?.kind === 'crs') parts.push('view=crs');
  else if (page?.kind === 'diff') {
    parts.push(`diff=${encodeURIComponent(page.path)}`);
    if (page.from !== undefined) parts.push(`from=${encodeURIComponent(page.from)}`);
  } else if (page) parts.push(`${page.kind === 'note' ? 'path' : 'asset'}=${encodeURIComponent(page.path)}`);
  return `?${parts.join('&')}`;
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

// What the site serves for a worktree path: a note's page, a file under
// public/ as it is (`/notes/…`), and the notes' home for anything else.
export function siteRoute(path: string | null) {
  if (path === null) return '/notes';
  if (path.startsWith('public/')) return `/${path.slice('public/'.length).split('/').map(encodeURIComponent).join('/')}`;
  return noteRoute(path);
}

// Where Open preview goes for the page shown: its route on the site, or the
// notes home when the page has none there. A diff has the route of the file
// as it is now; a meta.yaml has no page, and a file the change request
// deleted (`exists` says no) is no longer served.
export function previewRoute(page: Page | null, exists: (path: string) => boolean) {
  if (page === null || page.kind === 'crs') return siteRoute(null);
  if (page.kind === 'diff' && (page.path.endsWith('/meta.yaml') || !exists(page.path))) return siteRoute(null);
  return siteRoute(page.path);
}
