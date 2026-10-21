// Client for change requests (server/cr/api.ts). Types mirror
// server/cr/manager.ts. Always at /api/crs, whichever worktree the page edits.

import { errorOf, readJson } from './json';

export type CrStatus = 'draft' | 'previewing' | 'review' | 'merged' | 'closed';

export type ChangeRequest = {
  slug: string;
  name: string;
  branch: string;
  status: CrStatus;
  pushed: boolean;
  worktree: string | null;
  changedPages: number;
  uncommitted: number;
  updatedMs: number;
  previewUrl: string | null;
  pr: { number: number; url: string } | null;
};

export type Discard = { slug: string; branch: string; worktree: string | null; commits: number; uncommitted: number; pushed: boolean; pr: { number: number; url: string } | null };

// `enabled`: false in a Studio over one worktree, which edits it directly.
export type CrList = { enabled: boolean; crs: ChangeRequest[]; prError: string | null };

export function createCrClient(base = '') {
  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw await errorOf(response);
    return readJson<T>(response);
  }

  return {
    // `fresh` reads the pull requests again instead of the server's cached ones.
    async list(fresh = false): Promise<CrList> {
      const response = await fetch(`${base}/api/crs${fresh ? '?fresh=1' : ''}`);
      if (!response.ok) throw await errorOf(response);
      return readJson<CrList>(response);
    },

    async create(name: string): Promise<ChangeRequest> {
      return (await post<{ cr: ChangeRequest }>('/api/crs', { name })).cr;
    },

    // Removes it from this machine, or with `dryRun` only says what goes.
    async discard(slug: string, dryRun = false): Promise<Discard> {
      return (await post<{ discard: Discard }>(`/api/crs/${encodeURIComponent(slug)}/discard`, { dryRun })).discard;
    },
  };
}

export type CrClient = ReturnType<typeof createCrClient>;
