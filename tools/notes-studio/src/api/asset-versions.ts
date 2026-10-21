import { useSyncExternalStore } from 'react';
import { API_BASE } from './workspace';

// The mtime each asset under public/notes last changed to while the Studio
// was open, by worktree path. The file API serves assets with
// `Cache-Control: no-store`, but an <img> whose URL stays the same keeps
// what it shows, and a browser may reuse an image it already holds for the
// same URL. So a changed asset gets `&v=<mtime>` in its URL (assetUrl), and
// the images and frames already on the page that show it are pointed there.
const versions = new Map<string, number>();
const listeners = new Set<() => void>();

const fileUrl = (path: string, base = API_BASE) => `${base}/api/file?path=${encodeURIComponent(path)}`;

// The file API URL for an asset, with its version once it changed.
export function assetUrl(path: string, base = API_BASE) {
  const version = versions.get(path);
  return version === undefined ? fileUrl(path, base) : `${fileUrl(path, base)}&v=${String(version)}`;
}

// Records that `path` changed on disk to `mtimeMs`, from a file event or
// the answer to a replace.
export function assetChanged(path: string, mtimeMs: number) {
  if (versions.get(path) === mtimeMs) return;
  versions.set(path, mtimeMs);
  const shown = fileUrl(path);
  const next = assetUrl(path);
  for (const element of document.querySelectorAll<HTMLImageElement | HTMLIFrameElement>('img[src], iframe[src]')) {
    const src = element.getAttribute('src') ?? '';
    // The URL as written, with or without a version: never a longer path that starts the same.
    if (src === shown || src.startsWith(`${shown}&v=`)) element.setAttribute('src', next);
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// The asset's file API URL, kept up to date as it changes.
export function useAssetUrl(path: string) {
  return useSyncExternalStore(subscribe, () => assetUrl(path));
}
