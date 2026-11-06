// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetsClient } from '#api/assets.ts';
import type { createFilesClient, FileEvent } from '#api/files.ts';
import { useAssetList } from '#assets/useAssetList.ts';

function clients() {
  let listener: ((event: FileEvent) => void) | null = null;
  const listAssets = vi.fn(() => Promise.resolve([{ path: 'public/docs/a.png', mtimeMs: 1, usages: [] }]));
  const subscribeFileEvents = vi.fn((next: (event: FileEvent) => void) => {
    listener = next;
    return () => { listener = null; };
  });
  return {
    client: { listAssets } as unknown as AssetsClient,
    files: { subscribeFileEvents } as unknown as ReturnType<typeof createFilesClient>,
    listAssets,
    emit: (event: FileEvent) => { listener?.(event); },
    subscribed: () => listener !== null,
  };
}

afterEach(cleanup);

describe('useAssetList', () => {
  it('asks nothing while the view is hidden, and loads once it shows', async () => {
    const { client, files, listAssets, subscribed } = clients();
    const { result, rerender } = renderHook(({ enabled }) => useAssetList(client, files, enabled), { initialProps: { enabled: false } });
    expect(listAssets).not.toHaveBeenCalled();
    expect(subscribed()).toBe(false);
    rerender({ enabled: true });
    await waitFor(() => { expect(result.current.assets).toHaveLength(1); });
    expect(subscribed()).toBe(true);
    rerender({ enabled: false });
    expect(subscribed()).toBe(false);
    expect(result.current.assets).toHaveLength(1);
  });

  it('reloads after notes or assets change, not meta.yaml', async () => {
    const { client, files, listAssets, emit } = clients();
    renderHook(() => useAssetList(client, files));
    await waitFor(() => { expect(listAssets).toHaveBeenCalledTimes(1); });
    emit({ type: 'change', path: 'content/docs/guide/meta.yaml', mtimeMs: 2 });
    emit({ type: 'change', path: 'content/docs/guide/a.mdx', mtimeMs: 2 });
    emit({ type: 'add', path: 'public/docs/b.png', mtimeMs: 2 });
    await waitFor(() => { expect(listAssets).toHaveBeenCalledTimes(2); });
  });
});
