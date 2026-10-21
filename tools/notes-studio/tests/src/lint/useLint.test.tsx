// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { createFilesClient, FileEvent } from '../../../src/api/files';
import type { LintClient, LintIssue } from '../../../src/api/lint';
import { LINT_DELAY_MS, useLint } from '../../../src/lint/useLint';

type Files = ReturnType<typeof createFilesClient>;

const ISSUE: LintIssue = { rule: 'link-broken', severity: 'error', message: 'm', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 2, offset: 1 } };

function fakes() {
  let listener: ((event: FileEvent) => void) | null = null;
  const lintNote = vi.fn<LintClient['lintNote']>(() => Promise.resolve([ISSUE]));
  const files = {
    subscribeFileEvents: (next: (event: FileEvent) => void) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
  } as unknown as Files;
  return { lint: { lintNote }, lintNote, files, emit: (event: FileEvent) => listener?.(event) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useLint', () => {
  it('checks the text once typing pauses', async () => {
    const { lint, lintNote, files } = fakes();
    const { result, rerender } = renderHook(({ text }) => useLint(lint, files, 'content/notes/a.mdx', text), { initialProps: { text: 'a' } });
    expect(result.current).toEqual({ status: 'checking', issues: null });
    rerender({ text: 'ab' });
    await act(() => vi.advanceTimersByTimeAsync(LINT_DELAY_MS - 1));
    rerender({ text: 'abc' });
    await act(() => vi.advanceTimersByTimeAsync(LINT_DELAY_MS));
    expect(lintNote).toHaveBeenCalledOnce();
    expect(lintNote.mock.calls[0]?.slice(0, 2)).toEqual(['content/notes/a.mdx', 'abc']);
    expect(result.current).toEqual({ status: 'ready', issues: [ISSUE] });
  });

  it('checks again when a file changes on disk, keeping the last result meanwhile', async () => {
    const { lint, lintNote, files, emit } = fakes();
    const { result } = renderHook(() => useLint(lint, files, 'content/notes/a.mdx', 'text'));
    await act(() => vi.advanceTimersByTimeAsync(LINT_DELAY_MS));
    lintNote.mockResolvedValueOnce([]);
    act(() => {
      emit({ type: 'unlink', path: 'content/notes/b.mdx', mtimeMs: null });
    });
    await act(() => vi.advanceTimersByTimeAsync(LINT_DELAY_MS));
    expect(lintNote).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ status: 'ready', issues: [] });
  });

  it('does not check again for a save of the note itself', async () => {
    const { lint, lintNote, files, emit } = fakes();
    renderHook(() => useLint(lint, files, 'content/notes/a.mdx', 'text'));
    await act(() => vi.advanceTimersByTimeAsync(LINT_DELAY_MS));
    act(() => {
      emit({ type: 'change', path: 'content/notes/a.mdx', mtimeMs: 2 });
    });
    await act(() => vi.advanceTimersByTimeAsync(LINT_DELAY_MS));
    expect(lintNote).toHaveBeenCalledOnce();
  });

  it('waits for the note to open', async () => {
    const { lint, lintNote, files } = fakes();
    const { result, rerender } = renderHook(({ text }: { text: string | null }) => useLint(lint, files, 'content/notes/a.mdx', text), {
      initialProps: { text: null as string | null },
    });
    await act(() => vi.advanceTimersByTimeAsync(LINT_DELAY_MS * 3));
    expect(lintNote).not.toHaveBeenCalled();
    expect(result.current).toEqual({ status: 'checking', issues: null });
    rerender({ text: 'loaded' });
    await act(() => vi.advanceTimersByTimeAsync(LINT_DELAY_MS));
    expect(lintNote).toHaveBeenCalledOnce();
  });

  it('reports a failed check and keeps the last issues', async () => {
    const { lint, lintNote, files } = fakes();
    const { result, rerender } = renderHook(({ text }) => useLint(lint, files, 'content/notes/a.mdx', text), { initialProps: { text: 'a' } });
    await act(() => vi.advanceTimersByTimeAsync(LINT_DELAY_MS));
    lintNote.mockRejectedValueOnce(new Error('offline'));
    rerender({ text: 'b' });
    await act(() => vi.advanceTimersByTimeAsync(LINT_DELAY_MS));
    expect(result.current).toEqual({ status: 'failed', issues: [ISSUE], error: 'Error: offline' });
  });
});
