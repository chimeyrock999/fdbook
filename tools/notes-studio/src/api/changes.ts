// Client for the changes API (server/git/api.ts), in the worktree the page
// edits (src/api/workspace.ts). Types mirror server/git/status.ts and
// server/git/history.ts; paths are worktree paths.

import { errorOf, readJson } from './json';
import { API_BASE } from './workspace';

export type ChangeStatus = 'M' | 'A' | 'D' | 'R';
export type ChangedFile = { path: string; status: ChangeStatus; from?: string };
export type Changes = { branch: string | null; files: ChangedFile[] };
export type CommitFile = { status: 'M' | 'A' | 'D'; path: string };
export type Commit = { sha: string; date: string; message: string; files: CommitFile[] };
export type History = { base: string | null; commits: Commit[] };

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
