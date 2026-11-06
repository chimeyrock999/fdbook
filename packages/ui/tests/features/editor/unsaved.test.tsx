// @vitest-environment jsdom
import type { DocumentStatus } from '@fumadocs-editor/core/sync';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepUnsaved, unsavedOf, useUnsaved, type UnsavedOffer } from '#features/editor/unsaved.ts';
import { UnsavedNotice } from '#features/editor/UnsavedNotice.tsx';

const WHO = 'alice';
const PATH = 'streaming/index.mdx';
const DISK = '# Streaming\n';

type Props = { text: string; disk: string | null; status: DocumentStatus | null };

// One editor of PATH: `setText` is what Restore puts in it.
function editor(initial: Props) {
  const setText = vi.fn();
  const hook = renderHook((props: Props) => useUnsaved(WHO, PATH, { ...props, setText }), { initialProps: initial });
  return { ...hook, setText };
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('unsaved text in sessionStorage', () => {
  it('is kept per change request and note, and read back', () => {
    keepUnsaved(WHO, PATH, { text: 'a', base: 'b', savedMs: 1 });
    expect(unsavedOf(WHO, PATH)).toEqual({ text: 'a', base: 'b', savedMs: 1 });
    expect(unsavedOf(WHO, 'other.mdx')).toBeNull();
    expect(unsavedOf('bob', PATH)).toBeNull();
    expect(Object.keys(sessionStorage)).toEqual([`notes-studio:unsaved:alice:_main:${PATH}`]);
    keepUnsaved(WHO, PATH, null);
    expect(unsavedOf(WHO, PATH)).toBeNull();
  });

  it('reads nothing from a broken entry, and storage that throws breaks nothing', () => {
    sessionStorage.setItem(`notes-studio:unsaved:alice:_main:${PATH}`, '{"text":1}');
    expect(unsavedOf(WHO, PATH)).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => { keepUnsaved(WHO, PATH, { text: 'a', base: 'b', savedMs: 1 }); }).not.toThrow();
    expect(unsavedOf(WHO, PATH)).toBeNull();
  });
});

describe('useUnsaved', () => {
  it('keeps the text while it is not saved, and drops it once it is', () => {
    const { rerender } = editor({ text: '', disk: null, status: null });
    rerender({ text: DISK, disk: DISK, status: 'synced' });
    expect(unsavedOf(WHO, PATH)).toBeNull();
    rerender({ text: `${DISK}\nmine\n`, disk: DISK, status: 'dirty' });
    expect(unsavedOf(WHO, PATH)).toMatchObject({ text: `${DISK}\nmine\n`, base: DISK });
    // The session ends: the socket closes before the save.
    rerender({ text: `${DISK}\nmine, more\n`, disk: DISK, status: 'offline' });
    expect(unsavedOf(WHO, PATH)).toMatchObject({ text: `${DISK}\nmine, more\n`, base: DISK });
    rerender({ text: `${DISK}\nmine, more\n`, disk: DISK, status: 'synced' });
    expect(unsavedOf(WHO, PATH)).toBeNull();
  });

  it('keeps nothing for a note offline but not edited', () => {
    const { rerender } = editor({ text: DISK, disk: DISK, status: 'synced' });
    rerender({ text: DISK, disk: DISK, status: 'offline' });
    expect(unsavedOf(WHO, PATH)).toBeNull();
  });

  it('weighs edits against the last saved text', () => {
    const { rerender } = editor({ text: DISK, disk: DISK, status: 'synced' });
    rerender({ text: `${DISK}saved\n`, disk: DISK, status: 'dirty' });
    rerender({ text: `${DISK}saved\n`, disk: DISK, status: 'saving' });
    rerender({ text: `${DISK}saved\n`, disk: DISK, status: 'synced' });
    expect(unsavedOf(WHO, PATH)).toBeNull();
    rerender({ text: `${DISK}saved\nnot yet\n`, disk: DISK, status: 'offline' });
    expect(unsavedOf(WHO, PATH)?.base).toBe(`${DISK}saved\n`);
  });

  it('offers what an earlier editor kept once the note is open, and restores it', () => {
    keepUnsaved(WHO, PATH, { text: `${DISK}mine\n`, base: DISK, savedMs: 5 });
    const { result, rerender, setText } = editor({ text: '', disk: null, status: null });
    expect(result.current.offer).toBeNull();
    rerender({ text: DISK, disk: DISK, status: 'synced' });
    expect(result.current.offer).toEqual({ text: `${DISK}mine\n`, base: DISK, savedMs: 5, changed: false });
    // Not overwritten nor dropped while the offer stands.
    expect(unsavedOf(WHO, PATH)?.text).toBe(`${DISK}mine\n`);
    act(() => { result.current.restore(); });
    expect(setText).toHaveBeenCalledWith(`${DISK}mine\n`);
    expect(result.current.offer).toBeNull();
    expect(unsavedOf(WHO, PATH)).toBeNull();
    // The restored text is kept again until it is saved.
    rerender({ text: `${DISK}mine\n`, disk: DISK, status: 'dirty' });
    expect(unsavedOf(WHO, PATH)).toMatchObject({ text: `${DISK}mine\n`, base: DISK });
  });

  it('says when the note changed since the edits started, and drops them on Discard', () => {
    keepUnsaved(WHO, PATH, { text: `${DISK}mine\n`, base: DISK, savedMs: 5 });
    const { result, rerender } = editor({ text: '', disk: null, status: null });
    rerender({ text: `${DISK}theirs\n`, disk: `${DISK}theirs\n`, status: 'synced' });
    expect(result.current.offer?.changed).toBe(true);
    act(() => { result.current.discard(); });
    expect(result.current.offer).toBeNull();
    expect(unsavedOf(WHO, PATH)).toBeNull();
  });

  it('keeps text set straight in the editor before it reports dirty (Source, a restore)', () => {
    const { rerender } = editor({ text: DISK, disk: DISK, status: 'synced' });
    rerender({ text: `${DISK}typed in Source\n`, disk: DISK, status: 'synced' });
    expect(unsavedOf(WHO, PATH)).toMatchObject({ text: `${DISK}typed in Source\n`, base: DISK });
    rerender({ text: `${DISK}typed in Source\n`, disk: DISK, status: 'dirty' });
    rerender({ text: `${DISK}typed in Source\n`, disk: DISK, status: 'offline' });
    expect(unsavedOf(WHO, PATH)).toMatchObject({ text: `${DISK}typed in Source\n`, base: DISK });
  });

  it('takes a change merged in from disk as the disk once it settles', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = editor({ text: DISK, disk: DISK, status: 'synced' });
      rerender({ text: `${DISK}from disk\n`, disk: DISK, status: 'synced' });
      act(() => { vi.advanceTimersByTime(1500); });
      expect(unsavedOf(WHO, PATH)).toBeNull();
      rerender({ text: `${DISK}from disk\nmine\n`, disk: DISK, status: 'offline' });
      expect(unsavedOf(WHO, PATH)?.base).toBe(`${DISK}from disk\n`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops its text when it closes while it can still save, and keeps it when it cannot', () => {
    const saving = editor({ text: DISK, disk: DISK, status: 'synced' });
    saving.rerender({ text: `${DISK}mine\n`, disk: DISK, status: 'dirty' });
    saving.unmount();
    expect(unsavedOf(WHO, PATH)).toBeNull();
    const offline = editor({ text: DISK, disk: DISK, status: 'synced' });
    offline.rerender({ text: `${DISK}mine\n`, disk: DISK, status: 'offline' });
    offline.unmount();
    expect(unsavedOf(WHO, PATH)?.text).toBe(`${DISK}mine\n`);
  });

  it('leaves an offer it did not take for the next editor', () => {
    keepUnsaved(WHO, PATH, { text: `${DISK}mine\n`, base: DISK, savedMs: 5 });
    const first = editor({ text: '', disk: null, status: null });
    first.rerender({ text: DISK, disk: DISK, status: 'synced' });
    first.unmount();
    expect(unsavedOf(WHO, PATH)?.text).toBe(`${DISK}mine\n`);
  });

  it('offers nothing when the disk already holds the edits', () => {
    keepUnsaved(WHO, PATH, { text: `${DISK}mine\n`, base: DISK, savedMs: 5 });
    const { result, rerender } = editor({ text: '', disk: null, status: null });
    rerender({ text: `${DISK}mine\n`, disk: `${DISK}mine\n`, status: 'synced' });
    expect(result.current.offer).toBeNull();
    expect(unsavedOf(WHO, PATH)).toBeNull();
  });
});

describe('UnsavedNotice', () => {
  const offer = (more: Partial<UnsavedOffer> = {}): UnsavedOffer => ({ text: 'mine', base: 'old', savedMs: Date.now() - 120_000, changed: false, ...more });

  it('offers to restore or discard the edits', async () => {
    const onRestore = vi.fn();
    const onDiscard = vi.fn();
    render(<UnsavedNotice offer={offer()} writable onRestore={onRestore} onDiscard={onDiscard} />);
    expect(screen.getByRole('status').textContent).toContain('Edits made before your session ended were not saved (2 min ago).');
    expect(screen.queryByText(/changed since/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Restore edits' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('warns that restoring goes over changes made since', () => {
    render(<UnsavedNotice offer={offer({ changed: true })} writable onRestore={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText(/The note changed since/)).toBeTruthy();
  });

  it('lets someone who may no longer write copy the edits', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      render(<UnsavedNotice offer={offer()} writable={false} onRestore={vi.fn()} onDiscard={vi.fn()} />);
      expect(screen.queryByRole('button', { name: 'Restore edits' })).toBeNull();
      expect(screen.getByText('mine', { selector: 'pre' })).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: 'Copy edits' }));
      expect(writeText).toHaveBeenCalledWith('mine');
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
});
