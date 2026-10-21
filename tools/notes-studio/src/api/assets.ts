import { errorOf, readJson } from './json';

// Client for the assets API (server/assets/api.ts). Types mirror
// server/assets/ops.ts; paths are worktree paths (`public/notes/…`,
// `content/notes/…`).

// Where a note uses an asset. `unsure`: the note does not parse, and the
// line holds the file name.
export type AssetUsage = { note: string; line: number; column: number; length: number; text: string; unsure: boolean };
export type AssetInfo = { path: string; mtimeMs: number; usages: AssetUsage[] };

export type AssetChange =
  | { type: 'move'; path: string; to: string }
  | { type: 'change'; path: string; detail: string }
  | { type: 'delete'; path: string };

export type AssetRequest =
  | { op: 'rename'; path: string; name: string; baseMtime: number }
  | { op: 'delete'; path: string; baseMtime: number };

export type AssetAnswer = { changes: AssetChange[]; usages: AssetUsage[] };

export function createAssetsClient(base = '') {
  async function failed(response: Response): Promise<never> {
    throw await errorOf(response);
  }

  return {
    async listAssets(): Promise<AssetInfo[]> {
      const response = await fetch(`${base}/api/assets`);
      if (!response.ok) return failed(response);
      return (await readJson<{ assets: AssetInfo[] }>(response)).assets;
    },

    // Applies the change, or with `dryRun` only says what it would write.
    async change(request: AssetRequest, dryRun = false): Promise<AssetAnswer> {
      const response = await fetch(`${base}/api/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, dryRun }),
      });
      if (!response.ok) return failed(response);
      return readJson<AssetAnswer>(response);
    },
  };
}

export type AssetsClient = ReturnType<typeof createAssetsClient>;
