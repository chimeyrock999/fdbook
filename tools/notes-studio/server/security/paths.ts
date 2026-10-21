import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_TYPES, ASSETS_DIR, extensionOf } from './asset-types.ts';

export { ASSET_TYPES, ASSETS_DIR, extensionOf };

// The only files the Studio may touch, as worktree-relative posix paths.
// Every surface (file API, file events, notes sync) asks this one module.
export const NOTES_DIR = 'content/notes';

export type PathKind = 'note' | 'meta' | 'asset';

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
  if (under(ASSETS_DIR)) return extensionOf(name) in ASSET_TYPES ? 'asset' : null;
  return null;
}

// Walks the path from the worktree root with lstat and refuses any symlink on
// the way, even one that stays inside the area: a save replaces the file, so
// it would silently turn a linked note into a copy. Missing segments are fine
// (a new file); an existing file must be a regular file. Synchronous and
// cheap, so the sync server can call it on every message.
export function resolveWorktreePath(root: string, path: string) {
  const kind = classifyPath(path);
  if (!kind) return null;
  const segments = path.split('/');
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    let info;
    try {
      info = lstatSync(current);
    } catch {
      break;
    }
    const last = index === segments.length - 1;
    if (info.isSymbolicLink() || (last ? !info.isFile() : !info.isDirectory())) return null;
  }
  return { kind, absolute: join(root, path) };
}
