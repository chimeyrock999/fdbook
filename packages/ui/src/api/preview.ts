// Client for the preview API (server/preview/api.ts), in the worktree the
// page edits (src/api/workspace.ts). Types mirror server/preview/preview.ts,
// server/preview/check-runs.ts, server/preview/pull-request.ts and
// server/preview/publish.ts.

import { errorOf, readJson } from './json';
import { studioFetch } from './session';
import { API_BASE } from './workspace';

export type BuildState = 'waiting' | 'building' | 'ready' | 'failed' | 'skipped' | 'none' | 'unknown';
export type Build = { state: BuildState; logUrl: string | null; deploymentUrl: string | null; aliasUrl: string | null; at: string | null; error: string | null };
export type PullRequestState = 'OPEN' | 'MERGED' | 'CLOSED';
export type BranchPullRequest = { number: number; url: string; state: PullRequestState; title: string };
export type PublishDraft = { title: string; body: string };
export type Preview = {
  branch: string | null;
  blocked: string | null;
  pushed: { sha: string } | null;
  // Newest first.
  unpushed: string[];
  uncommitted: number;
  url: string | null;
  build: Build | null;
  pr: BranchPullRequest | null;
  prError: string | null;
};

export function createPreviewClient(base = API_BASE) {
  return {
    async load(): Promise<Preview> {
      const response = await studioFetch(`${base}/api/preview`);
      if (!response.ok) throw await errorOf(response);
      return readJson<Preview>(response);
    },

    // Pushes the change request's commits; answers the preview after the push.
    async push(): Promise<Preview> {
      const response = await studioFetch(`${base}/api/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw await errorOf(response);
      return readJson<Preview>(response);
    },

    // The pull request's title and description to start from.
    async draft(): Promise<PublishDraft> {
      const response = await studioFetch(`${base}/api/publish`);
      if (!response.ok) throw await errorOf(response);
      return readJson<PublishDraft>(response);
    },

    // Pushes what is not pushed and opens the pull request; answers the preview with it.
    async publish(title: string, body: string): Promise<Preview> {
      const response = await studioFetch(`${base}/api/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body }) });
      if (!response.ok) throw await errorOf(response);
      return readJson<Preview>(response);
    },
  };
}

export type PreviewClient = ReturnType<typeof createPreviewClient>;
