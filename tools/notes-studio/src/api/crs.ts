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
  stale: boolean;
  drift: Drift | null;
};

// The commits main has that the change request does not, and the files a
// merge of main would conflict in.
export type Drift = { behind: number; conflicts: string[] };

export type Discard = {
  slug: string;
  branch: string;
  status: CrStatus;
  worktree: string | null;
  commits: number;
  uncommitted: number;
  pushed: boolean;
  unpushed: number;
  pr: { number: number; url: string } | null;
  closesPr: { number: number; url: string } | null;
  // Why gh could not read the pull requests: a pushed one cannot be discarded then.
  prError: string | null;
};

export type DiscardSeen = { pushed: boolean; closesPr: number | null };

// `enabled`: false in a Studio over one worktree, which edits it directly.
// `taken`: the slugs a new change request cannot take, as the server picks one.
// `fetchError`: why a fresh list could not fetch origin.
export type CrList = { enabled: boolean; crs: ChangeRequest[]; taken: string[]; prError: string | null; fetchError: string | null };

export function createCrClient(base = '') {
  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw await errorOf(response);
    return readJson<T>(response);
  }

  return {
    // `fresh` fetches origin and reads the pull requests again instead of the server's cached ones.
    async list(fresh = false): Promise<CrList> {
      const response = await fetch(`${base}/api/crs${fresh ? '?fresh=1' : ''}`);
      if (!response.ok) throw await errorOf(response);
      return readJson<CrList>(response);
    },

    async create(name: string): Promise<ChangeRequest> {
      return (await post<{ cr: ChangeRequest }>('/api/crs', { name })).cr;
    },

    // Removes it from origin and this machine, or with `dryRun` only says
    // what goes. `seen`: what the dry run said about origin; the server
    // refuses when origin has changed since.
    async discard(slug: string, dryRun = false, seen?: DiscardSeen): Promise<Discard> {
      return (await post<{ discard: Discard }>(`/api/crs/${encodeURIComponent(slug)}/discard`, { dryRun, seen })).discard;
    },
  };
}

export type CrClient = ReturnType<typeof createCrClient>;
