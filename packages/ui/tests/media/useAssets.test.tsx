// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { createFilesClient, FileEntry, FileEvent } from '#api/files.ts';
import { useAssets } from '#media/useAssets.ts';

afterEach(cleanup);

function fakes() {
  let listener: ((event: FileEvent) => void) | null = null;
  let finishList: (entries: FileEntry[]) => void = () => undefined;
  let failList: () => void = () => undefined;
  const files = {
    subscribeFileEvents: (next: (event: FileEvent) => void) => {
      listener = next;
      return () => { listener = null; };
    },
    listFiles: () => new Promise<FileEntry[]>((resolve, reject) => {
      finishList = resolve;
      failList = () => { reject(new Error('offline')); };
    }),
  } as unknown as ReturnType<typeof createFilesClient>;
  return {
    files,
    emit: (event: FileEvent) => { act(() => { listener?.(event); }); },
    list: async (entries: FileEntry[]) => { await act(async () => { finishList(entries); await Promise.resolve(); }); },
    fail: async () => { await act(async () => { failList(); await Promise.resolve(); }); },
  };
}

const entry = (path: string, kind: FileEntry['kind'] = 'asset'): FileEntry => ({ path, kind, mtimeMs: 1, size: 1 });

describe('useAssets', () => {
  it('lists assets only and follows the disk, including events that arrive while listing', async () => {
    const { files, emit, list } = fakes();
    const { result } = renderHook(() => useAssets(files));
    expect(result.current).toEqual([]);
    emit({ type: 'add', path: 'public/docs/a/new.png', mtimeMs: 2 });
    emit({ type: 'unlink', path: 'public/docs/a/old.png', mtimeMs: null });
    emit({ type: 'change', path: 'content/docs/a.mdx', mtimeMs: 2 });
    await list([entry('public/docs/a/old.png'), entry('public/docs/b.svg'), entry('content/docs/a.mdx', 'note')]);
    expect(result.current).toEqual(['public/docs/a/new.png', 'public/docs/b.svg']);
    emit({ type: 'add', path: 'public/docs/a/upload.png', mtimeMs: 3 });
    emit({ type: 'unlink', path: 'public/docs/b.svg', mtimeMs: null });
    expect(result.current).toEqual(['public/docs/a/new.png', 'public/docs/a/upload.png']);
  });

  it('keeps following the disk when the list fails', async () => {
    const { files, emit, fail } = fakes();
    const { result } = renderHook(() => useAssets(files));
    emit({ type: 'add', path: 'public/docs/a/early.png', mtimeMs: 2 });
    await fail();
    expect(result.current).toEqual(['public/docs/a/early.png']);
    emit({ type: 'add', path: 'public/docs/a/upload.png', mtimeMs: 3 });
    expect(result.current).toEqual(['public/docs/a/early.png', 'public/docs/a/upload.png']);
  });
});
