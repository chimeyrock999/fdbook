// Client for the preview API (server/preview/api.ts), in the worktree the
// page edits (src/api/workspace.ts). Types mirror server/preview/preview.ts
// and server/preview/check-runs.ts.

import { errorOf, readJson } from './json';
import { API_BASE } from './workspace';

export type BuildState = 'waiting' | 'building' | 'ready' | 'failed' | 'none' | 'unknown';
export type Build = { state: BuildState; logUrl: string | null; deploymentUrl: string | null; aliasUrl: string | null; at: string | null; error: string | null };
export type Preview = {
  branch: string | null;
  blocked: string | null;
  pushed: { sha: string } | null;
  // Newest first.
  unpushed: string[];
  uncommitted: number;
  url: string | null;
  build: Build | null;
};

export function createPreviewClient(base = API_BASE) {
  return {
    async load(): Promise<Preview> {
      const response = await fetch(`${base}/api/preview`);
      if (!response.ok) throw await errorOf(response);
      return readJson<Preview>(response);
    },

    // Pushes the change request's commits; answers the preview after the push.
    async push(): Promise<Preview> {
      const response = await fetch(`${base}/api/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw await errorOf(response);
      return readJson<Preview>(response);
    },
  };
}

export type PreviewClient = ReturnType<typeof createPreviewClient>;
