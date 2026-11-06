// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastStack } from '#actions/ToastStack.tsx';
import type { DeleteProposalView } from '#api/proposals.ts';
import type { TreeAnswer, TreeClient, TreeFolder, TreeRequest } from '#api/tree.ts';
import { DeleteDialog } from '#tree/DeleteDialog.tsx';
import { PageTree } from '#tree/PageTree.tsx';

afterEach(cleanup);

const root: TreeFolder = {
  kind: 'folder', id: 'folder:', path: '', title: 'Notes', meta: 'meta.yaml', metaMtime: 10, index: 'index.mdx', defaultOpen: true, icon: null, hidden: null, entry: null,
  children: [
    { kind: 'page', id: 'page:index.mdx', path: 'index.mdx', title: 'Home', icon: null, entry: 0, hidden: null },
    {
      kind: 'folder', id: 'folder:guide', path: 'guide', title: 'Guide', meta: 'guide/meta.yaml', metaMtime: 20, index: null, defaultOpen: true, icon: null, hidden: null, entry: 1,
      children: [{ kind: 'page', id: 'page:guide/setup.mdx', path: 'guide/setup.mdx', title: 'Setup', icon: null, entry: 0, hidden: null }],
    },
  ],
};

const PLAN: TreeAnswer = {
  changes: [
    { type: 'delete', path: 'guide/setup.mdx' },
    { type: 'change', path: 'guide/meta.yaml', detail: 'removes "setup"' },
    { type: 'keep', path: 'public/docs/guide/setup/shared.png', detail: 'used by solo.mdx' },
    { type: 'delete', path: 'public/docs/guide/setup/shot.png' },
  ],
  open: null,
  base: 'base-one',
  links: [{ note: 'solo.mdx', line: 5, href: '/docs/guide/setup' }],
  deleted: ['guide/setup.mdx'],
};

const proposal: DeleteProposalView = {
  id: 'p1', path: 'guide/setup.mdx', by: { kind: 'run', runId: 'r1', agent: 'claude', model: null }, summary: 'Superseded.', createdMs: 1, decided: null, state: 'open',
};

function fakeClient(answer: (request: TreeRequest, dryRun: boolean) => TreeAnswer | Error) {
  const change = vi.fn((request: TreeRequest, dryRun?: boolean) => {
    const result = answer(request, dryRun ?? false);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
  return { client: { loadTree: () => Promise.resolve(root), change } as TreeClient, change };
}

const target = { path: 'guide/setup.mdx', title: 'Setup', folder: false };

describe('DeleteDialog', () => {
  it('shows the dry run by group with the links it breaks, and deletes with its base', async () => {
    const { client, change } = fakeClient(() => PLAN);
    const onDone = vi.fn();
    render(<DeleteDialog client={client} target={target} onDone={onDone} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Delete “Setup”?' });
    expect(await within(dialog).findByText('Deleted')).toBeTruthy();
    expect(within(dialog).getByText('Changed')).toBeTruthy();
    expect(within(dialog).getByText('Kept')).toBeTruthy();
    expect(within(dialog).getByRole('group', { name: 'Links that will break' }).textContent).toContain('solo.mdx:5');
    expect(change).toHaveBeenCalledWith({ op: 'delete', path: 'guide/setup.mdx' }, true);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(change).toHaveBeenLastCalledWith({ op: 'delete', path: 'guide/setup.mdx', base: 'base-one' });
    await waitFor(() => { expect(onDone).toHaveBeenCalled(); });
  });

  it('reads the list again when the notes changed since, and says so', async () => {
    let calls = 0;
    const { client } = fakeClient((_request, dryRun) => {
      calls += 1;
      if (!dryRun) return Object.assign(new Error('the notes changed since the dry run: check the list again'), { status: 409 });
      return { ...PLAN, base: calls === 1 ? 'base-one' : 'base-two' };
    });
    const onDone = vi.fn();
    render(<DeleteDialog client={client} target={target} onDone={onDone} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByText('Deleted');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await within(dialog).findByText(/The notes changed since this list was made/)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    expect(calls).toBe(3);
  });

  it('says why a proposal could not be accepted, without reading the list again', async () => {
    const { client, change } = fakeClient(() => PLAN);
    const onAccept = vi.fn(() => Promise.reject(Object.assign(new Error('this delete was already rejected'), { status: 409 })));
    render(<><DeleteDialog client={client} target={target} proposal={proposal} onAccept={onAccept} onDone={vi.fn()} onClose={vi.fn()} /><ToastStack /></>);
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByText('Deleted');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('this delete was already rejected')).toBeTruthy();
    expect(within(dialog).queryByText(/The notes changed since/)).toBeNull();
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('waits while a note it takes has unsaved changes', async () => {
    const { client } = fakeClient(() => PLAN);
    render(<DeleteDialog client={client} target={{ path: 'guide', title: 'Guide', folder: true }} unsaved="guide/setup.mdx" onDone={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByText('Deleted');
    expect(within(dialog).getByRole('status').textContent).toContain('once it shows Saved');
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Delete folder' }).disabled).toBe(true);
  });

  it('cannot delete while the dry run is refused', async () => {
    const { client } = fakeClient(() => Object.assign(new Error('the root page and folder cannot be deleted'), { status: 400 }));
    render(<DeleteDialog client={client} target={{ path: 'index.mdx', title: 'Home', folder: false }} onDone={vi.fn()} onClose={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('cannot be deleted');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Delete' }).disabled).toBe(true);
  });

  it('accepts a proposal with the base shown, or rejects it', async () => {
    const { client, change } = fakeClient(() => PLAN);
    const onAccept = vi.fn(() => Promise.resolve());
    const onReject = vi.fn(() => Promise.resolve());
    const onDone = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(<DeleteDialog client={client} target={target} proposal={proposal} onAccept={onAccept} onReject={onReject} onDone={onDone} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/proposed this delete: “Superseded.”/)).toBeTruthy();
    await within(dialog).findByText('Deleted');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(onAccept).toHaveBeenCalledWith('base-one');
    // The proposal's accept deletes on the server: the dialog sends no delete of its own.
    expect(change).toHaveBeenCalledTimes(1);
    await waitFor(() => { expect(onDone).toHaveBeenCalledWith(PLAN); });
    rerender(<DeleteDialog key="again" client={client} target={target} proposal={proposal} onAccept={onAccept} onReject={onReject} onDone={onDone} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reject proposal' }));
    await waitFor(() => { expect(onReject).toHaveBeenCalled(); });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('PageTree delete', () => {
  it('deletes from the row menu, says where to restore, and refuses the root page', async () => {
    const { client } = fakeClient(() => PLAN);
    const onDeleted = vi.fn();
    const onShowDeleted = vi.fn();
    render(<><PageTree root={root} client={client} active="guide/setup.mdx" onOpen={vi.fn()} onRenamed={vi.fn()} onChanged={vi.fn(() => Promise.resolve(true))} onDeleted={onDeleted} onShowDeleted={onShowDeleted} /><ToastStack /></>);
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Home' }));
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Delete…' }).disabled).toBe(true);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Setup' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete “Setup”?' });
    await within(dialog).findByText('Deleted');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(onDeleted).toHaveBeenCalledWith(PLAN); });
    expect(screen.getByRole('status').textContent).toContain('Deleted guide/setup.mdx.');
    await userEvent.click(screen.getByRole('button', { name: 'Restore it from Deleted pages' }));
    expect(onShowDeleted).toHaveBeenCalled();
  });

  it('marks a proposed delete and reviews it from the menu', async () => {
    const { client } = fakeClient(() => PLAN);
    const onDecideDelete = vi.fn(() => Promise.resolve());
    render(<PageTree root={root} client={client} active="guide/setup.mdx" deleting={new Map([[proposal.path, proposal]])} onOpen={vi.fn()} onRenamed={vi.fn()} onChanged={vi.fn(() => Promise.resolve(true))} onDecideDelete={onDecideDelete} />);
    expect(screen.getByLabelText('Delete proposed')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Setup' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Review proposed delete…' }));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByText('Deleted');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(onDecideDelete).toHaveBeenCalledWith('p1', 'accept', 'base-one'); });
  });

  it("deletes a folder's own page from the folder row, and shows a proposal for it there", async () => {
    const withIndex: TreeFolder = { ...root, children: root.children.map((child) => (child.kind === 'folder' ? { ...child, index: 'guide/index.mdx' } : child)) };
    const { client, change } = fakeClient(() => PLAN);
    const indexProposal = { ...proposal, id: 'p2', path: 'guide/index.mdx' };
    const { rerender } = render(<PageTree root={withIndex} client={client} active="guide/setup.mdx" onOpen={vi.fn()} onRenamed={vi.fn()} onChanged={vi.fn(() => Promise.resolve(true))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Guide' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete folder page…' }));
    await within(screen.getByRole('dialog', { name: 'Delete “Guide”?' })).findByText('Deleted');
    expect(change).toHaveBeenLastCalledWith({ op: 'delete', path: 'guide/index.mdx' }, true);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    rerender(<PageTree root={withIndex} client={client} active="guide/setup.mdx" deleting={new Map([[indexProposal.path, indexProposal]])} onOpen={vi.fn()} onRenamed={vi.fn()} onChanged={vi.fn(() => Promise.resolve(true))} />);
    expect(screen.getByRole('button', { name: 'Guide' }).closest('.studio-tree-row')?.querySelector('[aria-label="Delete proposed"]')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Guide' }));
    expect(screen.getByRole('menuitem', { name: 'Delete…' })).toBeTruthy();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Review proposed delete of its page…' }));
    expect(within(screen.getByRole('dialog')).getByText(/proposed this delete/)).toBeTruthy();
  });
});
