import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_TYPES, ASSETS_DIR, BASE_URL, classifyPath, DIAGRAMS_DIR, EDITABLE_AREAS, extensionOf, NOTES_DIR, PUBLIC_DIR, type PathKind } from '@fdbook/shared/asset-types.ts';

// The path policy: what may be touched (classifyPath, in asset-types.ts so
// the UI can ask it too) and where it is on disk.
export { ASSET_TYPES, ASSETS_DIR, BASE_URL, classifyPath, DIAGRAMS_DIR, EDITABLE_AREAS, extensionOf, NOTES_DIR, PUBLIC_DIR, type PathKind };

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
