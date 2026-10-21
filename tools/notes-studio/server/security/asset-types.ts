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
