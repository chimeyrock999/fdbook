// The asset types the Studio serves and saves under public/notes. No Node
// imports: the UI reads the same list to name an upload before it is sent.

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
