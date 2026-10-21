// Client for the changes API (server/git/api.ts), in the worktree the page
// edits (src/api/workspace.ts). Types mirror server/git/status.ts,
// server/git/history.ts and server/git/diff.ts; paths are worktree paths.

import { errorOf, readJson } from './json';
import { API_BASE } from './workspace';

export type ChangeStatus = 'M' | 'A' | 'D' | 'R';
export type ChangedFile = { path: string; status: ChangeStatus; from?: string };
export type Changes = { branch: string | null; files: ChangedFile[] };
export type CommitFile = { status: 'M' | 'A' | 'D'; path: string };
export type Commit = { sha: string; date: string; message: string; files: CommitFile[] };
export type History = { base: string | null; commits: Commit[] };
export type DiffSide = { kind: 'text'; text: string; size: number } | { kind: 'binary'; size: number };
export type DiffStatus = 'same' | 'M' | 'A' | 'D' | 'R';
export type FileDiff = { path: string; from?: string; base: string | null; status: DiffStatus; before: DiffSide | null; after: DiffSide | null };

export function createChangesClient(base = API_BASE) {
  async function failed(response: Response): Promise<never> {
    throw await errorOf(response);
  }

  return {
    async loadChanges(): Promise<Changes> {
      const response = await fetch(`${base}/api/changes`);
      if (!response.ok) return failed(response);
      return readJson<Changes>(response);
    },

    async loadHistory(): Promise<History> {
      const response = await fetch(`${base}/api/changes/history`);
      if (!response.ok) return failed(response);
      return readJson<History>(response);
    },

    // `path` against main; `from` is its old name, for a rename.
    async loadDiff(path: string, from?: string): Promise<FileDiff> {
      const query = new URLSearchParams({ path, ...(from === undefined ? {} : { from }) });
      const response = await fetch(`${base}/api/changes/diff?${query.toString()}`);
      if (!response.ok) return failed(response);
      return readJson<FileDiff>(response);
    },

    // Where the file is served as main holds it at `sha`, the diff's base;
    // the sha keeps an image of one base apart from the next.
    baseFileUrl(path: string, sha: string) {
      return `${base}/api/changes/blob?${new URLSearchParams({ path, base: sha }).toString()}`;
    },

    // Commits `paths`, and only them, with `message`; answers the new commit.
    async commit(message: string, paths: string[]): Promise<Commit> {
      const response = await fetch(`${base}/api/changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, paths }),
      });
      if (!response.ok) return failed(response);
      return readJson<Commit>(response);
    },
  };
}

export type ChangesClient = ReturnType<typeof createChangesClient>;
