// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { createFilesClient, FileEvent } from '../../../src/api/files';
import type { TreeClient, TreeFolder } from '../../../src/api/tree';
import { PageTree } from '../../../src/tree/PageTree';
import { useTree } from '../../../src/tree/useTree';

afterEach(cleanup);

const folder = (title: string): TreeFolder => ({
  kind: 'folder', id: 'folder:', path: '', title, meta: null, metaMtime: null, index: null, defaultOpen: false, icon: null, hidden: null, entry: null, children: [],
});

function Probe({ tree, files, onReload }: { tree: TreeClient; files: ReturnType<typeof createFilesClient>; onReload?: (reload: () => Promise<boolean>) => void }) {
  const { tree: root, error, reload } = useTree(tree, files);
  onReload?.(reload);
  return <p>{error ?? root?.title ?? 'loading'}</p>;
}

// The tree as App wires it: PageTree reloads through useTree.
function Sidebar({ tree, files }: { tree: TreeClient; files: ReturnType<typeof createFilesClient> }) {
  const { tree: root, reload } = useTree(tree, files);
  return <PageTree root={root} client={tree} active={null} onOpen={vi.fn()} onRenamed={vi.fn()} onChanged={reload} />;
}

function fileEvents() {
  let listener: (event: FileEvent) => void = () => undefined;
  const files = {
    subscribeFileEvents: (next: (event: FileEvent) => void) => {
      listener = next;
      return () => undefined;
    },
  } as unknown as ReturnType<typeof createFilesClient>;
  return { files, emit: (event: FileEvent) => { listener(event); } };
}

describe('useTree', () => {
  it('reloads once after a burst of note events and ignores assets', async () => {
    let listener: (event: FileEvent) => void = () => undefined;
    const files = {
      subscribeFileEvents: (next: (event: FileEvent) => void) => {
        listener = next;
        return () => undefined;
      },
    } as unknown as ReturnType<typeof createFilesClient>;
    const titles = ['First', 'Second', 'Third'];
    const loadTree = vi.fn(() => Promise.resolve(folder(titles.shift() ?? 'Last')));
    render(<Probe tree={{ loadTree } as unknown as TreeClient} files={files} />);
    expect(await screen.findByText('First')).toBeTruthy();

    listener({ type: 'change', path: 'public/docs/a.png', mtimeMs: 1 });
    listener({ type: 'unlink', path: 'content/docs/a.mdx', mtimeMs: null });
    listener({ type: 'add', path: 'content/docs/b.mdx', mtimeMs: 2 });
    listener({ type: 'change', path: 'content/docs/meta.yaml', mtimeMs: 3 });
    expect(await screen.findByText('Second')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(loadTree).toHaveBeenCalledTimes(2);
  });

  it('reports a tree that cannot load', async () => {
    const files = { subscribeFileEvents: () => () => undefined } as unknown as ReturnType<typeof createFilesClient>;
    render(<Probe tree={{ loadTree: () => Promise.reject(new Error('down')) } as unknown as TreeClient} files={files} />);
    await waitFor(() => { expect(screen.getByText('down')).toBeTruthy(); });
  });

  it('tells whether a reload loaded the tree', async () => {
    const files = { subscribeFileEvents: () => () => undefined } as unknown as ReturnType<typeof createFilesClient>;
    const loadTree = vi.fn(() => Promise.resolve(folder('Notes')));
    let reload: () => Promise<boolean> = () => Promise.resolve(false);
    render(<Probe tree={{ loadTree } as unknown as TreeClient} files={files} onReload={(next) => { reload = next; }} />);
    expect(await screen.findByText('Notes')).toBeTruthy();
    let result = false;
    await act(async () => { result = await reload(); });
    expect(result).toBe(true);
    loadTree.mockImplementationOnce(() => Promise.reject(new Error('down')));
    await act(async () => { result = await reload(); });
    expect(result).toBe(false);
  });

  it('does not focus a new folder from a load long after the reload that failed', async () => {
    const { files, emit } = fileEvents();
    const notes: TreeFolder = { ...folder('Notes'), children: [{ ...folder('Guide'), id: 'folder:guide', path: 'guide', entry: 0 }] };
    const raft: TreeFolder = { ...folder('Raft'), id: 'folder:raft', path: 'raft', meta: 'raft/meta.yaml', entry: 1 };
    const loadTree = vi.fn(() => Promise.resolve(notes));
    const change = vi.fn(() => Promise.resolve({ changes: [{ type: 'add', path: 'raft/meta.yaml' }], open: null, created: 'raft' }));
    render(<Sidebar tree={{ loadTree, change } as unknown as TreeClient} files={files} />);
    await userEvent.click(await screen.findByRole('button', { name: 'New page' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('radio', { name: /meta\.yaml/ }));
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Raft');
    // The create lands; the tree API fails on the reload right after it.
    loadTree.mockImplementationOnce(() => Promise.reject(new Error('down')));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await screen.findByRole('status');
    await waitFor(() => { expect(loadTree).toHaveBeenCalledTimes(2); });
    screen.getByRole('button', { name: 'Guide' }).focus();
    // Later a file event reloads a tree that holds the folder.
    loadTree.mockImplementation(() => Promise.resolve({ ...notes, children: [...notes.children, raft] }));
    emit({ type: 'change', path: 'content/docs/guide/one.mdx', mtimeMs: 1 });
    expect(await screen.findByRole('button', { name: 'Raft' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Guide' }));
  });
});
