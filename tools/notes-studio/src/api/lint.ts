// Client for the Studio lint (server/lint/api.ts). Types mirror
// server/lint/types.ts.

export type LintSeverity = 'error' | 'warning';
export type LintPoint = { line: number; column: number; offset: number };
export type LintIssue = { rule: string; severity: LintSeverity; message: string; start: LintPoint; end: LintPoint };

export function createLintClient(base = '') {
  return {
    // The issues of `content` as the note at `path` (worktree-relative).
    async lintNote(path: string, content: string, signal?: AbortSignal): Promise<LintIssue[]> {
      const response = await fetch(`${base}/api/lint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
        signal,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${String(response.status)}`);
      }
      return ((await response.json()) as { issues: LintIssue[] }).issues;
    },
  };
}

export type LintClient = ReturnType<typeof createLintClient>;
