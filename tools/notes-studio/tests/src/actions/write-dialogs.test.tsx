// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastStack } from '../../../src/actions/ToastStack';
import type { AssetInfo, AssetsClient } from '../../../src/api/assets';
import type { TreeClient, TreeFolder } from '../../../src/api/tree';
import { DeleteAssetDialog, RenameAssetDialog } from '../../../src/assets/AssetDialogs';
import { CreateDialog, RenameDialog } from '../../../src/tree/TreeDialogs';

// The write dialogs (#138): Enter twice sends one request, the dialog
// neither closes nor sends again while it is out, and a refusal says why
// in a toast while the dialog stays open to try again.

afterEach(cleanup);

const folder: TreeFolder = {
  kind: 'folder', id: 'folder:guide', path: 'guide', title: 'Guide', meta: 'guide/meta.yaml', metaMtime: 20, index: null,
  defaultOpen: true, icon: null, hidden: null, entry: null, children: [],
};
const page = { kind: 'page' as const, id: 'page:guide/one.mdx', path: 'guide/one.mdx', title: 'One', icon: null, entry: 0, hidden: null };
const asset: AssetInfo = { path: 'public/notes/guide/chart.png', mtimeMs: 5, size: 10, usages: [] };

// A promise the test settles.
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// A client whose dry runs answer at once and whose writes wait for the test.
function client<T>(write: Promise<T>) {
  const writes = vi.fn((request: unknown) => (request === null ? Promise.reject(new Error('no request')) : write));
  const change = vi.fn((request: unknown, dryRun?: boolean) => (dryRun === true ? Promise.resolve({ changes: [], open: null, usages: [] }) : writes(request)));
  return { change, writes };
}

const cases: { name: string; dialog: (change: ReturnType<typeof client>['change'], onDone: () => void, onClose: () => void) => ReactNode; ready: () => Promise<void>; refused: string }[] = [
  {
    name: 'a new page',
    dialog: (change, onDone, onClose) => <CreateDialog client={{ change } as unknown as TreeClient} parent={folder} after={null} onDone={onDone} onClose={onClose} />,
    ready: async () => { fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Raft' } }); await screen.findByRole('list', { name: 'Files to write' }); },
    refused: 'guide/raft.mdx already exists',
  },
  {
    name: 'a rename',
    dialog: (change, onDone, onClose) => <RenameDialog client={{ change } as unknown as TreeClient} node={page} unsaved={null} onDone={onDone} onClose={onClose} />,
    ready: async () => { fireEvent.change(screen.getByRole('textbox', { name: 'File name' }), { target: { value: 'first' } }); await screen.findByRole('list', { name: 'Files to write' }); },
    refused: 'guide/one.mdx is gone',
  },
  {
    name: 'an asset rename',
    dialog: (change, onDone, onClose) => <RenameAssetDialog client={{ change } as unknown as AssetsClient} asset={asset} onDone={onDone} onClose={onClose} />,
    ready: async () => { fireEvent.change(screen.getByRole('textbox', { name: 'File name' }), { target: { value: 'figure' } }); await screen.findByRole('list', { name: 'Files to write' }); },
    refused: 'chart.png changed on disk',
  },
  {
    name: 'an asset delete',
    dialog: (change, onDone, onClose) => <DeleteAssetDialog client={{ change } as unknown as AssetsClient} asset={asset} onDone={onDone} onClose={onClose} onOpenUsage={() => undefined} />,
    ready: () => Promise.resolve(),
    refused: 'no such file',
  },
];

describe.each(cases)('the dialog for $name', ({ dialog, ready, refused }) => {
  it('sends once however often it is submitted, and waits for its answer', async () => {
    const write = deferred<unknown>();
    const { change, writes } = client(write.promise);
    const onDone = vi.fn();
    const onClose = vi.fn();
    render(dialog(change, onDone, onClose));
    await ready();
    const form = screen.getByRole('dialog');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(form.getAttribute('aria-busy')).toBe('true');
    // Escape and the backdrop wait too.
    fireEvent.keyDown(form, { key: 'Escape' });
    if (form.parentElement) fireEvent.mouseDown(form.parentElement);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true);
    await act(async () => { write.resolve({ changes: [{ type: 'move', path: 'a', to: 'b' }], open: 'guide/raft.mdx', usages: [] }); await write.promise; });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('says why it was refused in a toast, and stays open to try again', async () => {
    const write = deferred<unknown>();
    const { change, writes } = client(write.promise);
    const onDone = vi.fn();
    render(<>{dialog(change, onDone, () => undefined)}<ToastStack /></>);
    await ready();
    fireEvent.submit(screen.getByRole('dialog'));
    await act(async () => { write.reject(new Error(refused)); await write.promise.catch(() => undefined); });
    expect(screen.getByRole('alert').textContent).toContain(refused);
    // Nothing inline: the toast says it.
    expect(screen.getByRole('dialog').querySelector('[role="alert"]')).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
    await waitFor(() => { expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBeNull(); });
    // The focus is back in the dialog, so Tab and Escape work.
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    fireEvent.submit(screen.getByRole('dialog'));
    expect(writes).toHaveBeenCalledTimes(2);
  });
});

describe('a dialog over the toasts', () => {
  it('leaves the toasts live, but not a notice that would leave the page', () => {
    render(
      <>
        <ToastStack><div data-leaves>Back to cr/x</div></ToastStack>
        <CreateDialog client={{ change: client(new Promise(() => undefined)).change } as unknown as TreeClient} parent={folder} after={null} onDone={() => undefined} onClose={() => undefined} />
      </>,
    );
    const stack = document.querySelector<HTMLElement>('[data-studio-toasts]');
    expect(stack).not.toBeNull();
    expect(stack?.inert).not.toBe(true);
    expect(stack?.querySelector<HTMLElement>('[data-leaves]')?.inert).toBe(true);
  });
});
