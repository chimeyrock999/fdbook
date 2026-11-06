import { BASE_URL, classifyPath, PUBLIC_DIR, siteUrlOf } from '@fdbook/shared/asset-types.ts';
import { CURRENT_CR } from '#api/workspace.ts';
import { NOTES_PREFIX, syncPath } from '#lib/note-paths.ts';
import { renamedPath } from '#tree/tree.ts';

// The page model: what the main pane shows, and the URL that opens it.

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

// What the main pane shows: a note, an asset or a diagram (diagrams/), by
// worktree path, a file's diff against main (renamed `from` an old path), a note's or an asset's
// history, the list of change requests, or the deleted pages.
export type Page = { kind: 'note' | 'asset' | 'diagram' | 'history'; path: string } | { kind: 'diff'; path: string; from?: string } | { kind: 'crs' | 'deleted' };

// Whether a page shows no file of its own: a list.
export const isList = (page: Page | null): page is { kind: 'crs' | 'deleted' } => page?.kind === 'crs' || page?.kind === 'deleted';

// The page to open from the URL: `?path=` names a note, `?asset=` a file
// under public/notes, `?diagram=` a diagram under diagrams/, `?diff=` (with `&from=` for a rename) any file the
// Studio may touch, `?history=` a note or an asset, `?view=crs` the change
// requests, `?view=deleted` the deleted pages.
// Paths take the server's own lexical check, so the page opens only what it
// serves.
export function pageFromUrl(search: string): Page | null {
  const note = noteFromUrl(search);
  if (note !== null) return { kind: 'note', path: note };
  const params = new URLSearchParams(search);
  const view = params.get('view');
  if (view === 'crs' || view === 'deleted') return { kind: view };
  const history = params.get('history');
  const historyKind = history === null ? null : classifyPath(history);
  if (history !== null && ((historyKind === 'note' && isNote(history)) || historyKind === 'asset')) return { kind: 'history', path: history };
  const asset = params.get('asset');
  if (asset !== null && classifyPath(asset) === 'asset') return { kind: 'asset', path: asset };
  const diagram = params.get('diagram');
  if (diagram !== null && classifyPath(diagram) === 'diagram') return { kind: 'diagram', path: diagram };
  const diff = params.get('diff');
  if (diff === null || classifyPath(diff) === null) return null;
  const from = params.get('from');
  return from !== null && classifyPath(from) !== null ? { kind: 'diff', path: diff, from } : { kind: 'diff', path: diff };
}

// `page` after the page tree renamed `from` to `to` (paths inside
// content/notes): the open note, or the note whose history is shown, under
// its new path; null when the rename does not move it.
export function movedPage(page: Page | null, from: string, to: string): Page | null {
  if (page?.kind !== 'note' && page?.kind !== 'history') return null;
  const moved = renamedPath(syncPath(page.path), from, to);
  return moved === null ? null : { kind: page.kind, path: NOTES_PREFIX + moved };
}

// The query that opens `page` in change request `cr` (null: main), the
// inverse of pageFromUrl and crFromSearch.
export function pageQuery(page: Page | null, cr: string | null = CURRENT_CR) {
  const parts = cr === null ? [] : [`cr=${cr}`];
  if (isList(page)) parts.push(`view=${page.kind}`);
  else if (page?.kind === 'diff') {
    parts.push(`diff=${encodeURIComponent(page.path)}`);
    if (page.from !== undefined) parts.push(`from=${encodeURIComponent(page.from)}`);
  } else if (page) parts.push(`${{ note: 'path', asset: 'asset', diagram: 'diagram', history: 'history' }[page.kind]}=${encodeURIComponent(page.path)}`);
  return `?${parts.join('&')}`;
}

// The note's page on the site, as fumadocs slugs it under `docsRoute`
// (lib/shared.ts, which reads process.env and so is not imported here): an
// `index` names its folder and a `(group)` folder adds no segment.
export function noteRoute(path: string) {
  const segments = syncPath(path).replace(/\.mdx$/, '').split('/');
  if (segments.at(-1) === 'index') segments.pop();
  const slugs = segments.filter((segment) => !/^\(.+\)$/.test(segment));
  return [BASE_URL, ...slugs.map(encodeURIComponent)].join('/');
}

// What the site serves for a worktree path: a note's page, a file under
// the public folder as it is (`/docs/…`), and the notes' home for anything
// else (a diagram is drawn in the notes, not served).
export function siteRoute(path: string | null) {
  const inPublic = path?.startsWith(`${PUBLIC_DIR}/`) === true;
  if (path === null || !(inPublic || path.startsWith(NOTES_PREFIX))) return BASE_URL;
  if (inPublic) return siteUrlOf(path).split('/').map(encodeURIComponent).join('/');
  return noteRoute(path);
}

// Where Open preview goes for the page shown: its route on the site, or the
// notes home when the page has none there. A diff has the route of the file
// as it is now; a meta.yaml has no page, and a file the change request
// deleted (`exists` says no) is no longer served.
export function previewRoute(page: Page | null, exists: (path: string) => boolean) {
  if (page === null || isList(page)) return siteRoute(null);
  if (page.kind === 'diff' && (page.path.endsWith('/meta.yaml') || !exists(page.path))) return siteRoute(null);
  return siteRoute(page.path);
}
