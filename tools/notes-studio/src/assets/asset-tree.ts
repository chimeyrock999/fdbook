import type { AssetInfo } from '../api/assets';
import { ASSETS_PREFIX } from '../media/asset-names';

// public/notes as folders, for the Assets view. Paths are worktree paths;
// the root is public/notes itself.
export type AssetFolder = { name: string; path: string; folders: AssetFolder[]; files: AssetInfo[] };

export const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

// The folders of the assets that match: `query` against the path under
// public/notes (case does not matter), `unused` keeps the assets no note
// uses. Folders, then files, each sorted by name.
export function buildAssetTree(assets: readonly AssetInfo[], { query = '', unused = false } = {}): AssetFolder {
  const root: AssetFolder = { name: '', path: ASSETS_PREFIX.slice(0, -1), folders: [], files: [] };
  const needle = query.trim().toLowerCase();
  for (const asset of assets) {
    if (!asset.path.startsWith(ASSETS_PREFIX)) continue;
    if (unused && asset.usages.length > 0) continue;
    const relative = asset.path.slice(ASSETS_PREFIX.length);
    if (needle !== '' && !relative.toLowerCase().includes(needle)) continue;
    let folder = root;
    for (const name of relative.split('/').slice(0, -1)) {
      let next = folder.folders.find((each) => each.name === name);
      if (!next) {
        next = { name, path: `${folder.path}/${name}`, folders: [], files: [] };
        folder.folders.push(next);
      }
      folder = next;
    }
    folder.files.push(asset);
  }
  const sort = (folder: AssetFolder) => {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name));
    folder.files.sort((a, b) => nameOf(a.path).localeCompare(nameOf(b.path)));
    folder.folders.forEach(sort);
  };
  sort(root);
  return root;
}

// The folders from public/notes down to `dir` (itself included), to open
// them: the open note's asset folder shows first.
export function foldersTo(dir: string): string[] {
  if (!dir.startsWith(ASSETS_PREFIX)) return [];
  const parts = dir.slice(ASSETS_PREFIX.length).split('/').filter(Boolean);
  return parts.map((_, index) => `${ASSETS_PREFIX}${parts.slice(0, index + 1).join('/')}`);
}
