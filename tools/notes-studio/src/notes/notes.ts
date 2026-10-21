export const NOTES_PREFIX = 'content/notes/';

// The file API speaks worktree paths, the sync socket paths inside content/notes.
export const syncPath = (path: string) => path.slice(NOTES_PREFIX.length);

const isNote = (path: string) => path.startsWith(NOTES_PREFIX) && path.endsWith('.mdx');

// The note to open from `?path=`, if it names a note.
export function noteFromUrl(search: string): string | null {
  const path = new URLSearchParams(search).get('path');
  return path !== null && isNote(path) ? path : null;
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
