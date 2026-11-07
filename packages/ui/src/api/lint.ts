// Client for the Studio lint (server/routes/lint.ts). Types mirror
// server/services/lint/types.ts.

import { errorOf, readJson } from './json';
import { studioFetch } from './session';
import { API_BASE } from './workspace';

export type LintSeverity = 'error' | 'warning';
export type LintPoint = { line: number; column: number; offset: number };
export type LintIssue = { rule: string; severity: LintSeverity; message: string; start: LintPoint; end: LintPoint };

export function createLintClient(base = API_BASE) {
  return {
    // The issues of `content` as the note at `path` (worktree-relative).
    async lintNote(path: string, content: string, signal?: AbortSignal): Promise<LintIssue[]> {
      const response = await studioFetch(`${base}/api/lint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
        signal,
      });
      if (!response.ok) throw await errorOf(response);
      return (await readJson<{ issues: LintIssue[] }>(response)).issues;
    },
  };
}

export type LintClient = ReturnType<typeof createLintClient>;
