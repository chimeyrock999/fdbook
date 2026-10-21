// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { createFilesClient, FileEvent } from '../../../src/api/files';
import type { TreeClient, TreeFolder } from '../../../src/api/tree';
import { useTree } from '../../../src/tree/useTree';

afterEach(cleanup);

const folder = (title: string): TreeFolder => ({
  kind: 'folder', id: 'folder:', path: '', title, meta: null, metaMtime: null, index: null, hidden: null, entry: null, children: [],
});

function Probe({ tree, files }: { tree: TreeClient; files: ReturnType<typeof createFilesClient> }) {
  const { tree: root, error } = useTree(tree, files);
  return <p>{error ?? root?.title ?? 'loading'}</p>;
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

    listener({ type: 'change', path: 'public/notes/a.png', mtimeMs: 1 });
    listener({ type: 'unlink', path: 'content/notes/a.mdx', mtimeMs: null });
    listener({ type: 'add', path: 'content/notes/b.mdx', mtimeMs: 2 });
    listener({ type: 'change', path: 'content/notes/meta.yaml', mtimeMs: 3 });
    expect(await screen.findByText('Second')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(loadTree).toHaveBeenCalledTimes(2);
  });

  it('reports a tree that cannot load', async () => {
    const files = { subscribeFileEvents: () => () => undefined } as unknown as ReturnType<typeof createFilesClient>;
    render(<Probe tree={{ loadTree: () => Promise.reject(new Error('down')) } as unknown as TreeClient} files={files} />);
    await waitFor(() => { expect(screen.getByText('down')).toBeTruthy(); });
  });
});
