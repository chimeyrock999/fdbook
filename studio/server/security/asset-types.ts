// The asset types the Studio serves and saves under public/notes. No Node
// imports: the UI reads the same list to name an upload before it is sent.

import { DIAGRAM_SUFFIX, DIAGRAMS_DIR } from '@site/lib/diagram/source.ts';

// Where assets live, as a worktree path.
export const ASSETS_DIR = 'public/notes';

export const ASSET_TYPES: Record<string, string> = {
  avif: 'image/avif',
  gif: 'image/gif',
  glb: 'model/gltf-binary',
  html: 'text/html; charset=utf-8',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

// Whether the Studio stores files with this (lowercase) extension. An own
// key only: `constructor` is not a type.
export const isAssetExtension = (extension: string) => Object.hasOwn(ASSET_TYPES, extension);

export function extensionOf(path: string) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
}

// The file under public/ that the site would read for `src`
// (lib/read-public-asset.ts), or null when it is outside public/.
export function publicAsset(src: string) {
  const segments: string[] = [];
  for (const segment of (src.split(/[?#]/)[0] ?? '').trim().split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.length > 0 ? segments.join('/') : null;
}

// Whether a file the Studio may touch is text: notes, meta.yaml, diagrams,
// and SVG and HTML assets. The diff (server/git/diff.ts) sends only the size of others.
export function isTextPath(path: string) {
  const kind = classifyPath(path);
  return kind !== null && (kind !== 'asset' || ['svg', 'html'].includes(extensionOf(path)));
}

// The only files the Studio may touch, as worktree-relative posix paths.
// Every surface (file API, file events, notes sync) asks this one module.
export const NOTES_DIR = 'content/notes';
// The diagrams <Diagram src> draws (lib/diagram/source.ts).
export { DIAGRAM_SUFFIX, DIAGRAMS_DIR };
// Every area the Studio lists, watches and diffs.
export const EDITABLE_AREAS = [NOTES_DIR, ASSETS_DIR, DIAGRAMS_DIR];

export type PathKind = 'note' | 'meta' | 'asset' | 'diagram';

// Lexical check only: no `..`, `.`, empty or hidden segments (`.obsidian`,
// temp files), no backslashes or NUL, and a known name under a known area.
export function classifyPath(path: string): PathKind | null {
  if (path.includes('\\') || path.includes('\0')) return null;
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment.startsWith('.'))) return null;
  const name = segments.at(-1) ?? '';
  const under = (dir: string) => path.startsWith(`${dir}/`);
  if (under(NOTES_DIR)) {
    if (name === 'meta.yaml') return 'meta';
    return name.endsWith('.mdx') ? 'note' : null;
  }
  if (under(ASSETS_DIR)) return isAssetExtension(extensionOf(name)) ? 'asset' : null;
  // Not diagrams/diagram.schema.json or any other file there.
  if (under(DIAGRAMS_DIR)) return name.endsWith(DIAGRAM_SUFFIX) ? 'diagram' : null;
  return null;
}
