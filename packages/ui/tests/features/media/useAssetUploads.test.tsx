// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { createFilesClient } from '#api/files.ts';
import { UploadCancelled } from '#features/media/asset-media.ts';
import { useAssetUploads } from '#features/media/useAssetUploads.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const png = (name: string) => new File([new Uint8Array([1])], name, { type: 'image/png' });

function filesStub() {
  const writeAsset = vi.fn(() => Promise.resolve(1));
  return { files: { writeAsset } as unknown as ReturnType<typeof createFilesClient>, writeAsset };
}

describe('useAssetUploads', () => {
  it('names images one at a time, in the order they came', async () => {
    const { files, writeAsset } = filesStub();
    const hook = renderHook(() => useAssetUploads(files, 'content/docs/data-modeling/index.mdx', []));
    const view = () => render(<>{hook.result.current.dialog}</>);
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      // Settled values, so a rejection is never left unobserved.
      first = hook.result.current.media.upload(png('one.png')).catch((error: unknown) => error);
      second = hook.result.current.media.upload(png('two.png')).catch((error: unknown) => error);
    });
    await vi.waitFor(() => { expect(hook.result.current.dialog).toBeTruthy(); });
    view();
    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('one');
    await userEvent.keyboard('{Enter}');
    await expect(first).resolves.toBe('/docs/data-modeling/one.png');
    cleanup();
    await vi.waitFor(() => { expect(hook.result.current.dialog).toBeTruthy(); });
    view();
    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('two');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await second).toBeInstanceOf(UploadCancelled);
    expect(writeAsset).toHaveBeenCalledOnce();
  });

  it('cancels the open and waiting names when the note closes', async () => {
    const { files, writeAsset } = filesStub();
    const hook = renderHook(() => useAssetUploads(files, 'content/docs/a.mdx', []));
    let uploads!: Promise<unknown>[];
    act(() => {
      uploads = ['one.png', 'two.png'].map((name) => hook.result.current.media.upload(png(name)).catch((error: unknown) => error));
    });
    await vi.waitFor(() => { expect(hook.result.current.dialog).toBeTruthy(); });
    hook.unmount();
    for (const upload of uploads) expect(await upload).toBeInstanceOf(UploadCancelled);
    expect(writeAsset).not.toHaveBeenCalled();
  });

  it('hides an error after a while', () => {
    vi.useFakeTimers();
    const { files } = filesStub();
    const hook = renderHook(() => useAssetUploads(files, 'content/docs/a.mdx', []));
    act(() => { hook.result.current.media.onError?.(new Error('disk full'), png('a.png')); });
    expect(hook.result.current.notice).toEqual({ kind: 'error', text: 'disk full' });
    act(() => { vi.advanceTimersByTime(8000); });
    expect(hook.result.current.notice).toBeNull();
  });
});
