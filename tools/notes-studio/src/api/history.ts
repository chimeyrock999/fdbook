// Client for the page history API (server/git/page-history-api.ts), in the
// worktree the page edits (src/api/workspace.ts). Types mirror
// server/git/page-history.ts; paths are worktree paths.

import type { DiffSide } from './changes';
import { errorOf, readJson } from './json';
import { studioFetch } from './session';
import { API_BASE } from './workspace';

export type PageVersion = { sha: string; date: string; author: string; message: string; path: string; status: 'A' | 'M' | 'R'; from?: string; inChangeRequest: boolean };
export type PageHistory = { path: string; mtimeMs: number | null; versions: PageVersion[] };
export type VersionRef = { version: string; path: string };
export type Comparison = { path: string; from: VersionRef | null; to: VersionRef; before: DiffSide | null; after: DiffSide | null };

// The page as it is on disk, committed or not, where a version is a sha.
export const NOW = 'now';

export function createHistoryClient(base = API_BASE) {
  async function failed(response: Response): Promise<never> {
    throw await errorOf(response);
  }

  return {
    async loadHistory(path: string): Promise<PageHistory> {
      const response = await studioFetch(`${base}/api/history?${new URLSearchParams({ path }).toString()}`);
      if (!response.ok) return failed(response);
      return readJson<PageHistory>(response);
    },

    // Version `from` (null: nothing) against version `to`, each a sha or NOW.
    async compare(path: string, from: string | null, to: string): Promise<Comparison> {
      const query = new URLSearchParams({ path, to, ...(from === null ? {} : { from }) });
      const response = await studioFetch(`${base}/api/history/compare?${query.toString()}`);
      if (!response.ok) return failed(response);
      return readJson<Comparison>(response);
    },

    // Writes version `sha` over the page, as long as the page is still the
    // one read at `mtimeMs`.
    async restore(path: string, sha: string, mtimeMs: number): Promise<{ path: string; mtimeMs: number }> {
      const response = await studioFetch(`${base}/api/history/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, sha, mtimeMs }),
      });
      if (!response.ok) return failed(response);
      return readJson<{ path: string; mtimeMs: number }>(response);
    },
  };
}

export type HistoryClient = ReturnType<typeof createHistoryClient>;
