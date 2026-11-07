import { errorOf, readJson } from './json';
import { studioFetch } from './session';
import { API_BASE } from './workspace';

// Client for the assets API (server/routes/assets.ts). Types mirror
// server/services/assets/ops.ts; paths are worktree paths (`public/notes/…`,
// `content/notes/…`).

// Where a note uses an asset. `unsure`: the Studio cannot rewrite it (the
// note does not parse and the line holds the file name, or the path is
// written with escapes it does not read).
export type AssetUsage = { note: string; line: number; column: number; length: number; text: string; unsure: boolean };
export type AssetInfo = { path: string; mtimeMs: number; size: number; usages: AssetUsage[] };

export type AssetChange =
  | { type: 'move'; path: string; to: string }
  | { type: 'change'; path: string; detail: string }
  | { type: 'delete'; path: string }
  // New content at `to`: the asset's own path, or its name with the new extension.
  | { type: 'replace'; path: string; to: string };

export type AssetRequest =
  | { op: 'rename'; path: string; name: string; baseMtime: number }
  | { op: 'delete'; path: string; baseMtime: number }
  // A dry run only: the content goes through `replace`.
  | { op: 'replace'; path: string; extension: string; baseMtime: number };

export type AssetAnswer = { changes: AssetChange[]; usages: AssetUsage[] };

export function createAssetsClient(base = API_BASE) {
  async function failed(response: Response): Promise<never> {
    throw await errorOf(response);
  }

  return {
    async listAssets(): Promise<AssetInfo[]> {
      const response = await studioFetch(`${base}/api/assets`);
      if (!response.ok) return failed(response);
      return (await readJson<{ assets: AssetInfo[] }>(response)).assets;
    },

    // Applies the change, or with `dryRun` only says what it would write.
    async change(request: AssetRequest, dryRun = false): Promise<AssetAnswer> {
      const response = await studioFetch(`${base}/api/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, dryRun }),
      });
      if (!response.ok) return failed(response);
      return readJson<AssetAnswer>(response);
    },

    // Puts `file` in place of the asset listed at `baseMtime`, under its own
    // path or, with another extension, its name with that one.
    async replace(path: string, extension: string, file: Blob, baseMtime: number): Promise<AssetAnswer & { mtimeMs: number }> {
      const query = new URLSearchParams({ path, extension, baseMtime: String(baseMtime) });
      const response = await studioFetch(`${base}/api/assets?${query.toString()}`, { method: 'PUT', headers: { 'X-Studio-Write': '1' }, body: file });
      if (!response.ok) return failed(response);
      return readJson<AssetAnswer & { mtimeMs: number }>(response);
    },
  };
}

export type AssetsClient = ReturnType<typeof createAssetsClient>;
