import { useEffect, useState } from 'react';
import type { createFilesClient } from '#api/files.ts';
import type { LintClient, LintIssue } from '#api/lint.ts';

export const LINT_DELAY_MS = 400;

export type LintState =
  | { status: 'checking'; issues: LintIssue[] | null }
  | { status: 'ready'; issues: LintIssue[] }
  | { status: 'failed'; issues: LintIssue[] | null; error: string };

// The open note's issue count for the activity bar, or null with no note.
export type IssueCount = { count: number; errors: boolean } | null;

// The issues of the note's text as it is being edited: checked a moment
// after typing stops, and again when another file changes on disk, since a
// note or asset that appears or goes away can fix or break a link. (Changes
// to this note arrive as new text.) The last
// result stays on screen while the next check runs. `text` is null until the
// note has opened, so an empty editor is never reported as clean.
export function useLint(lint: LintClient, files: ReturnType<typeof createFilesClient>, path: string, text: string | null): LintState {
  const [state, setState] = useState<LintState>({ status: 'checking', issues: null });
  const [diskVersion, setDiskVersion] = useState(0);

  useEffect(
    () =>
      files.subscribeFileEvents((event) => {
        if (event.path !== path) setDiskVersion((version) => version + 1);
      }),
    [files, path],
  );

  useEffect(() => {
    if (text === null) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState((previous) => ({ status: 'checking', issues: previous.issues }));
      lint.lintNote(path, text, controller.signal).then(
        (issues) => {
          setState({ status: 'ready', issues });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setState((previous) => ({ status: 'failed', issues: previous.issues, error: String(error) }));
        },
      );
    }, LINT_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [lint, path, text, diskVersion]);

  return state;
}
