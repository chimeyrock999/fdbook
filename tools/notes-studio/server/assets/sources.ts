import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ASSETS_DIR, extensionOf, isAssetExtension } from '../security/asset-types.ts';

// Assets that a diagram source generates: an Archify spec under diagrams/
// names its file in `meta.output`, and a `*.regen.sh` script in `OUT=`.
// Regenerating writes that path again, so a source counts like a usage:
// the Studio shows it, refuses to delete the asset, and says on a rename
// that the source still names the old path. It only reads them: diagrams/
// is outside what the Studio may write.

export const DIAGRAMS_DIR = 'diagrams';

// `path` is the worktree path of the source; `line` (1-based) and `text`
// are where it names the asset.
export type AssetSource = { path: string; line: number; text: string };

const MAX_SOURCE_BYTES = 1024 * 1024;
const OUT = /^\s*(?:export\s+)?OUT=(["']?)([^"'\s]+)\1\s*(?:#.*)?$/;

// `public/notes/…` for a file the Studio manages there, else null.
function managed(path: string) {
  const clean = path.replace(/^\.\//, '');
  return clean.startsWith(`${ASSETS_DIR}/`) && isAssetExtension(extensionOf(clean)) ? clean : null;
}

function named(content: string, path: string): { asset: string; line: number }[] {
  const lines = content.split('\n');
  if (path.endsWith('.regen.sh')) {
    return lines.flatMap((line, index) => {
      const asset = managed(OUT.exec(line)?.[2] ?? '');
      return asset === null ? [] : [{ asset, line: index + 1 }];
    });
  }
  let output: unknown;
  try {
    output = (JSON.parse(content) as { meta?: { output?: unknown } } | null)?.meta?.output;
  } catch {
    return [];
  }
  const asset = typeof output === 'string' ? managed(output) : null;
  if (asset === null || typeof output !== 'string') return [];
  const index = lines.findIndex((line) => line.includes(JSON.stringify(output)));
  return [{ asset, line: index + 1 || 1 }];
}

// Every source under diagrams/, by the asset it generates. Symlinks, other
// files and files over 1 MB are skipped.
export async function findAssetSources(root: string): Promise<Map<string, AssetSource[]>> {
  const sources = new Map<string, AssetSource[]>();
  const entries = await readdir(join(root, DIAGRAMS_DIR), { recursive: true }).catch(() => []);
  const files = entries
    .map((entry) => `${DIAGRAMS_DIR}/${entry.split('\\').join('/')}`)
    .filter((path) => path.endsWith('.json') || path.endsWith('.regen.sh'))
    .sort();
  for (const path of files) {
    const info = await lstat(join(root, path)).catch(() => null);
    if (!info?.isFile() || info.size > MAX_SOURCE_BYTES) continue;
    const content = await readFile(join(root, path), 'utf8').catch(() => null);
    if (content === null) continue;
    const lines = content.split('\n');
    for (const { asset, line } of named(content, path)) {
      const list = sources.get(asset) ?? [];
      list.push({ path, line, text: (lines[line - 1] ?? '').trim() });
      sources.set(asset, list);
    }
  }
  return sources;
}
