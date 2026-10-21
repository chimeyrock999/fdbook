// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeAnswer, TreeClient, TreeFolder, TreeRequest } from '../../../src/api/tree';
import { PageTree } from '../../../src/tree/PageTree';

const root: TreeFolder = {
  kind: 'folder', id: 'folder:', path: '', title: 'Notes', meta: 'meta.yaml', metaMtime: 10, index: null, defaultOpen: true, hidden: null, entry: null,
  children: [
    {
      kind: 'folder', id: 'folder:guide', path: 'guide', title: 'Guide', meta: 'guide/meta.yaml', metaMtime: 20, index: 'guide/index.mdx',
      defaultOpen: true, hidden: null, entry: 0,
      children: [
        { kind: 'page', id: 'page:guide/one.mdx', path: 'guide/one.mdx', title: 'One', entry: 0, hidden: null },
        { kind: 'page', id: 'page:guide/two.mdx', path: 'guide/two.mdx', title: 'Two', entry: 1, hidden: null },
        { kind: 'missing', id: 'missing:guide/meta.yaml:2', entry: 2, value: 'gone', meta: 'guide/meta.yaml' },
        { kind: 'page', id: 'page:guide/rest.mdx', path: 'guide/rest.mdx', title: 'From rest', entry: null, hidden: null },
      ],
    },
    { kind: 'separator', id: 'separator:meta.yaml:1', entry: 1, title: 'Later' },
    { kind: 'page', id: 'page:draft.mdx', path: 'draft.mdx', title: 'Draft', entry: null, hidden: 'unlisted' },
    {
      kind: 'folder', id: 'folder:old', path: 'old', title: 'Old', meta: 'old/meta.yaml', metaMtime: 30, index: null,
      defaultOpen: false, hidden: 'visible-false', entry: null,
      children: [{ kind: 'page', id: 'page:old/x.mdx', path: 'old/x.mdx', title: 'X', entry: 0, hidden: null }],
    },
    {
      kind: 'folder', id: 'folder:loose', path: 'loose', title: 'Loose', meta: null, metaMtime: null, index: null,
      defaultOpen: false, hidden: null, entry: null, children: [],
    },
  ],
};

function fakeClient(answer: (request: TreeRequest, dryRun: boolean) => TreeAnswer | Error) {
  const change = vi.fn((request: TreeRequest, dryRun?: boolean) => {
    const result = answer(request, dryRun ?? false);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
  return { client: { loadTree: () => Promise.resolve(root), change } as TreeClient, change };
}

function setup(answer: Parameters<typeof fakeClient>[0] = () => ({ changes: [], open: null })) {
  const { client, change } = fakeClient(answer);
  const props = { onOpen: vi.fn(), onRenamed: vi.fn(), onChanged: vi.fn() };
  render(<PageTree root={root} client={client} active="guide/two.mdx" {...props} />);
  return { change, ...props };
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe('PageTree', () => {
  it('shows the tree in meta.yaml order with what the site hides', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Two' }).closest('[aria-current]')?.getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Later')).toBeTruthy();
    expect(screen.getByTitle('guide/meta.yaml: “gone” reaches no page or folder.')).toBeTruthy();
    const badges = screen.getAllByText('hidden');
    expect(badges.map((badge) => badge.closest('.studio-tree-row')?.textContent)).toEqual([expect.stringContaining('Draft'), expect.stringContaining('Old')]);
    expect(screen.getByTitle(/No meta.yaml lists it/)).toBeTruthy();
    // `Old` is closed until opened; Guide is open because the open note is in it.
    expect(screen.queryByRole('button', { name: 'X' })).toBeNull();
  });

  it('starts folders closed, whatever the site would open', async () => {
    const { client } = fakeClient(() => ({ changes: [], open: null }));
    render(<PageTree root={root} client={client} active={null} onOpen={vi.fn()} onRenamed={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Expand Guide' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'One' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Expand Guide' }));
    expect(screen.getByRole('button', { name: 'One' })).toBeTruthy();
    // Its child level hangs off a guide line.
    expect(screen.getByRole('button', { name: 'One' }).closest('ul')?.className).toContain('studio-tree-nested');
  });

  it('opens notes and folders', async () => {
    const { onOpen } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'One' }));
    expect(onOpen).toHaveBeenCalledWith('guide/one.mdx');
    await userEvent.click(screen.getByRole('button', { name: 'Guide' }));
    expect(onOpen).toHaveBeenCalledWith('guide/index.mdx');
    await userEvent.click(screen.getByRole('button', { name: 'Expand Old' }));
    expect(screen.getByRole('button', { name: 'X' })).toBeTruthy();
    // Kept for the next visit.
    expect(localStorage.getItem('notes-studio:tree-open')).toContain('folder:old');
  });

  it('filters by title and keeps the folders on the way', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('Filter notes'), 'tw');
    expect(screen.getAllByRole('button', { name: /^(Guide|Two|One|Draft)$/ }).map((button) => button.textContent)).toEqual(['Guide', 'Two']);
    await userEvent.type(screen.getByLabelText('Filter notes'), 'zzz');
    expect(screen.getByText(/No note matches/)).toBeTruthy();
  });

  it('moves an entry up from the menu, with the meta.yaml mtime', async () => {
    const { change, onChanged } = setup(() => ({ changes: [{ type: 'change', path: 'guide/meta.yaml', detail: 'new order' }], open: null }));
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Two' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole<HTMLButtonElement>('menuitem', { name: 'Move down' }).disabled).toBe(false);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Move up' }));
    expect(change).toHaveBeenCalledWith({ op: 'move', folder: 'guide', from: 1, to: 0, baseMtime: 20 });
    expect((await screen.findByRole('status')).textContent).toBe('Saved the order in guide/meta.yaml.');
    expect(onChanged).toHaveBeenCalled();
  });

  it('explains why an entry cannot move', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for From rest' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole<HTMLButtonElement>('menuitem', { name: 'Move up' }).disabled).toBe(true);
    expect(menu.textContent).toContain('no entry of its own in guide/meta.yaml');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('reports a move the server refused', async () => {
    setup(() => new Error('content/notes/guide/meta.yaml changed on disk'));
    await userEvent.click(screen.getByRole('button', { name: 'Actions for One' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect((await screen.findByRole('alert')).textContent).toContain('changed on disk');
  });

  it('creates a page below the chosen one and opens it', async () => {
    const { change, onOpen } = setup((request, dryRun) =>
      request.op === 'create' && request.slug === 'taken'
        ? new Error('content/notes/guide/taken.mdx already exists')
        : { changes: [{ type: 'add', path: 'guide/raft-consensus.mdx' }, { type: 'change', path: 'guide/meta.yaml', detail: 'adds "raft-consensus"' }], open: dryRun ? null : 'guide/raft-consensus.mdx' },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Actions for One' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'New page below' }));
    const dialog = screen.getByRole('dialog', { name: 'New page in Guide' });
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Raft Consensus');
    expect(within(dialog).getByLabelText<HTMLInputElement>('Slug').value).toBe('raft-consensus');
    expect(await within(dialog).findByText('+ guide/raft-consensus.mdx')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(change).toHaveBeenLastCalledWith({ op: 'create', parent: 'guide', slug: 'raft-consensus', title: 'Raft Consensus', kind: 'page', defaultOpen: false, after: 0 });
    await waitFor(() => { expect(onOpen).toHaveBeenCalledWith('guide/raft-consensus.mdx'); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('creates a plain folder, then opens it and focuses its row', async () => {
    const { client, change } = fakeClient(() => ({
      changes: [{ type: 'add', path: 'guide/raft/meta.yaml' }, { type: 'change', path: 'guide/meta.yaml', detail: 'adds "raft"' }],
      open: null,
    }));
    const props = { client, active: null, onOpen: vi.fn(), onRenamed: vi.fn(), onChanged: vi.fn() };
    const { rerender } = render(<PageTree root={root} {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Guide' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'New page here' }));
    const dialog = screen.getByRole('dialog', { name: 'New page in Guide' });
    // Only folders have a defaultOpen to set.
    expect(within(dialog).queryByLabelText(/Open by default/)).toBeNull();
    await userEvent.click(within(dialog).getByRole('radio', { name: /meta\.yaml/ }));
    expect(screen.getByRole('dialog', { name: 'New folder in Guide' })).toBe(dialog);
    expect(within(dialog).getByLabelText<HTMLInputElement>(/Open by default/).checked).toBe(false);
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Raft');
    expect(within(dialog).getByRole('radio', { name: /meta\.yaml/ }).closest('label')?.textContent).toContain('raft/meta.yaml');
    expect(await within(dialog).findByText('+ guide/raft/meta.yaml')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(change).toHaveBeenLastCalledWith({ op: 'create', parent: 'guide', slug: 'raft', title: 'Raft', kind: 'folder', defaultOpen: false, after: null });
    expect((await screen.findByRole('status')).textContent).toBe('Created guide/raft/.');
    expect(props.onOpen).not.toHaveBeenCalled();
    expect(props.onChanged).toHaveBeenCalled();
    // The reloaded tree holds the folder: it is open, with Guide, and has focus.
    const guide = root.children[0] as TreeFolder;
    const raft: TreeFolder = { ...guide, id: 'folder:guide/raft', path: 'guide/raft', title: 'Raft', meta: 'guide/raft/meta.yaml', index: null, defaultOpen: false, entry: 2, children: [] };
    rerender(<PageTree root={{ ...root, children: [{ ...guide, children: [...guide.children, raft] }, ...root.children.slice(1)] }} {...props} />);
    expect(screen.getByRole('button', { name: 'Collapse Raft' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Raft' }));
  });

  it('creates a folder page open by default when asked', async () => {
    const { change } = setup((_request, dryRun) => ({ changes: [{ type: 'add', path: 'raft/index.mdx' }], open: dryRun ? null : 'raft/index.mdx' }));
    await userEvent.click(screen.getByRole('button', { name: 'New page' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('radio', { name: /index\.mdx/ }));
    expect(dialog.getAttribute('aria-label')).toBe('New folder page in Notes');
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Raft');
    await userEvent.click(within(dialog).getByLabelText(/Open by default/));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(change).toHaveBeenLastCalledWith({ op: 'create', parent: '', slug: 'raft', title: 'Raft', kind: 'folder-page', defaultOpen: true, after: null });
  });

  it('sets defaultOpen from the folder menu', async () => {
    const { change, onChanged } = setup(() => ({ changes: [{ type: 'change', path: 'guide/meta.yaml', detail: 'defaultOpen: false' }], open: null }));
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Guide' }));
    const item = within(screen.getByRole('menu')).getByRole('menuitemcheckbox', { name: 'Open by default on the site' });
    expect(item.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(item);
    expect(change).toHaveBeenCalledWith({ op: 'set-open', folder: 'guide', defaultOpen: false, baseMtime: 20 });
    expect((await screen.findByRole('status')).textContent).toBe('Saved defaultOpen: false in guide/meta.yaml.');
    expect(onChanged).toHaveBeenCalled();
    // A folder without meta.yaml has nowhere to keep it.
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Loose' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole<HTMLButtonElement>('menuitemcheckbox', { name: 'Open by default on the site' }).disabled).toBe(true);
    expect(menu.textContent).toContain('No meta.yaml');
    // Pages have no such item.
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for One' }));
    expect(within(screen.getByRole('menu')).queryByRole('menuitemcheckbox')).toBeNull();
  });

  it('shows why a create would be refused', async () => {
    setup((request) => (request.op === 'create' && request.slug === 'taken' ? new Error('content/notes/taken.mdx already exists') : { changes: [], open: null }));
    await userEvent.click(screen.getByRole('button', { name: 'New page' }));
    const dialog = screen.getByRole('dialog', { name: 'New page in Notes' });
    await userEvent.type(within(dialog).getByLabelText('Slug'), 'Taken');
    expect((await within(dialog).findByRole('alert')).textContent).toContain('already exists');
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Create' }).disabled).toBe(true);
  });

  it('waits for the open note to be saved before renaming it or its folder', async () => {
    const { client } = fakeClient(() => ({ changes: [], open: null }));
    render(<PageTree root={root} client={client} active="guide/two.mdx" unsaved="guide/two.mdx" onOpen={vi.fn()} onRenamed={vi.fn()} onChanged={vi.fn()} />);
    for (const name of ['Two', 'Guide']) {
      await userEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }));
      expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Rename…' }).disabled).toBe(true);
      expect(screen.getByRole('menu').textContent).toContain('unsaved changes');
      await userEvent.keyboard('{Escape}');
    }
    await userEvent.click(screen.getByRole('button', { name: 'Actions for One' }));
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Rename…' }).disabled).toBe(false);
  });

  it('keeps the rename dialog modal and waits for a save that starts while it is open', async () => {
    const { client } = fakeClient(() => ({ changes: [{ type: 'move', path: 'guide/two.mdx', to: 'guide/2.mdx' }], open: null }));
    const props = { root, client, active: 'guide/two.mdx', onOpen: vi.fn(), onRenamed: vi.fn(), onChanged: vi.fn() };
    const { container, rerender } = render(<PageTree {...props} unsaved={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Two' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }));
    // The rest of the Studio (the editor too) cannot take focus or input.
    expect(container.inert).toBe(true);
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('File name'), '-b');
    expect(await within(dialog).findByText('guide/two.mdx → guide/2.mdx')).toBeTruthy();
    // Tab from the last button comes back to the first field.
    within(dialog).getByRole('button', { name: 'Rename' }).focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(within(dialog).getByLabelText('File name'));
    rerender(<PageTree {...props} unsaved="guide/two.mdx" />);
    expect(within(dialog).getByRole('status').textContent).toContain('unsaved changes');
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Rename' }).disabled).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.inert).toBe(false);
  });

  it('opens the folders on the way once a reloaded tree holds the open note', () => {
    const { client } = fakeClient(() => ({ changes: [], open: null }));
    const props = { client, onOpen: vi.fn(), onRenamed: vi.fn(), onChanged: vi.fn() };
    // The note was just renamed into `old`, which is closed by default; the tree has not reloaded yet.
    const stale: TreeFolder = { ...root, children: root.children.filter((child) => child.id !== 'folder:old') };
    const { rerender } = render(<PageTree root={stale} active="old/x.mdx" {...props} />);
    rerender(<PageTree root={root} active="old/x.mdx" {...props} />);
    expect(screen.getByRole('button', { name: 'X' }).closest('[aria-current]')).toBeTruthy();
  });

  it('renames a folder and reports where it went', async () => {
    const { change, onRenamed } = setup(() => ({
      changes: [{ type: 'move', path: 'guide', to: 'manual' }, { type: 'change', path: 'index.mdx', detail: '2 links' }],
      open: null,
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Guide' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename “Guide”' });
    const input = within(dialog).getByLabelText('Folder name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Manual');
    expect(await within(dialog).findByText('guide → manual')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    expect(change).toHaveBeenLastCalledWith({ op: 'rename', path: 'guide', slug: 'manual' });
    await waitFor(() => { expect(onRenamed).toHaveBeenCalledWith('guide', 'manual'); });
  });
});
