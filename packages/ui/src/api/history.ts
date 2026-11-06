// Client for the page history API (server/routes/page-history.ts), in the
// worktree the page edits (src/api/workspace.ts). Types mirror
// server/services/git/page-history.ts and server/services/git/deleted-pages.ts; paths are
// worktree paths, of a note or an asset.

import type { DiffSide } from './changes';
import { errorOf, readJson } from './json';
import { studioFetch } from './session';
import { API_BASE } from './workspace';

export type PageVersion = { sha: string; date: string; author: string; message: string; path: string; status: 'A' | 'M' | 'R'; from?: string; inChangeRequest: boolean };
export type DeletedIn = { sha: string; date: string; author: string; message: string };
export type PageHistory = { path: string; mtimeMs: number | null; deleted: DeletedIn | null; versions: PageVersion[] };
// `committed: false`: deleted in the worktree, not committed yet (`sha` is the version to restore).
export type DeletedPage = { path: string; title: string; sha: string; date: string; author: string; message: string; folderGone: boolean; committed: boolean };
export type DeletedRestore = { path: string; open: string; changes: { type: 'add' | 'change'; path: string; detail?: string }[] };
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

    // Writes version `sha` over the file, as long as it is still the one
    // read at `mtimeMs`. An asset may come back under another extension:
    // `path` is where it is now.
    async restore(path: string, sha: string, mtimeMs: number): Promise<{ path: string; mtimeMs: number }> {
      const response = await studioFetch(`${base}/api/history/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, sha, mtimeMs }),
      });
      if (!response.ok) return failed(response);
      return readJson<{ path: string; mtimeMs: number }>(response);
    },

    // Where version `sha` of a file is served, for an image's side.
    versionUrl(path: string, sha: string) {
      return `${base}/api/changes/blob?${new URLSearchParams({ path, base: sha }).toString()}`;
    },

    // The pages deleted on HEAD, newest delete first.
    async loadDeleted(): Promise<DeletedPage[]> {
      const response = await studioFetch(`${base}/api/history/deleted`);
      if (!response.ok) return failed(response);
      return (await readJson<{ pages: DeletedPage[] }>(response)).pages;
    },

    // Brings back deleted page `path` as version `sha` held it, with the
    // folders deleted with it; with `dryRun`, only what that would write.
    async restoreDeleted(path: string, sha: string, dryRun = false): Promise<DeletedRestore> {
      const response = await studioFetch(`${base}/api/history/restore-deleted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, sha, dryRun }),
      });
      if (!response.ok) return failed(response);
      return readJson<DeletedRestore>(response);
    },
  };
}

export type HistoryClient = ReturnType<typeof createHistoryClient>;
