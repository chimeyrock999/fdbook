// Where a project keeps what the Studio edits, as worktree-relative posix
// paths: the notes, the pages' files (under `publicDir`, which the site
// serves at /), the diagrams <Diagram src> draws, and the URL the site gives
// the notes. Set once from fdbook.config.ts when the server starts
// (server/project.ts); the UI gets the same through Vite's `define`. No Node
// imports: the UI reads this module too.
export type Areas = { notes: string; assets: string; publicDir: string; diagrams: string; baseUrl: string };

export const DEFAULT_AREAS: Areas = { notes: 'content/docs', assets: 'public/docs', publicDir: 'public', diagrams: 'diagrams', baseUrl: '/docs' };

declare const __FDBOOK_AREAS__: Areas | undefined;

// The only files the Studio may touch. Every surface (file API, file events,
// notes sync) asks the path policy (policy.ts), which reads these. Live
// bindings: setAreas changes them, and the re-exports stay live.
export let NOTES_DIR = '';
export let ASSETS_DIR = '';
export let PUBLIC_DIR = '';
export let DIAGRAMS_DIR = '';
export let BASE_URL = '';
// Every area the Studio lists, watches and diffs.
export let EDITABLE_AREAS: string[] = [];

export function setAreas(areas: Areas) {
  if (areas.assets !== areas.publicDir && !areas.assets.startsWith(`${areas.publicDir}/`)) {
    throw new Error(`The media folder ${areas.assets} is not inside ${areas.publicDir}, so the site would not serve it.`);
  }
  ({ notes: NOTES_DIR, assets: ASSETS_DIR, publicDir: PUBLIC_DIR, diagrams: DIAGRAMS_DIR, baseUrl: BASE_URL } = areas);
  EDITABLE_AREAS = [NOTES_DIR, ASSETS_DIR, DIAGRAMS_DIR];
}

export const currentAreas = (): Areas => ({ notes: NOTES_DIR, assets: ASSETS_DIR, publicDir: PUBLIC_DIR, diagrams: DIAGRAMS_DIR, baseUrl: BASE_URL });

setAreas(typeof __FDBOOK_AREAS__ === 'undefined' ? DEFAULT_AREAS : __FDBOOK_AREAS__);

// The URL the site serves a file under the public folder at, and back.
export const siteUrlOf = (path: string) => `/${path.slice(PUBLIC_DIR.length + 1)}`;
export const publicPathOf = (url: string) => `${PUBLIC_DIR}/${url.replace(/^\/+/, '')}`;
