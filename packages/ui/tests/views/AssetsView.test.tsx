// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetAnswer, AssetInfo, AssetRequest, AssetsClient, AssetUsage } from '#api/assets.ts';
import { AssetsView } from '#views/AssetsView.tsx';

const usage = (note: string, line: number): AssetUsage => ({ note, line, column: 12, length: 20, text: `![x](/docs/guide/${String(line)}.png)`, unsure: false });

const ASSETS: AssetInfo[] = [
  { path: 'public/docs/guide/flow.html', mtimeMs: 5, size: 100, usages: [usage('content/docs/guide/intro.mdx', 17), usage('content/docs/guide/index.mdx', 40)] },
  { path: 'public/docs/guide/old_name.png', mtimeMs: 7, size: 100, usages: [usage('content/docs/guide/intro.mdx', 9)] },
  { path: 'public/docs/guide/spare.svg', mtimeMs: 9, size: 100, usages: [] },
  { path: 'public/docs/other/pic.png', mtimeMs: 1, size: 100, usages: [] },
  { path: 'public/docs/other/Photo.PNG', mtimeMs: 2, size: 100, usages: [] },
  { path: 'public/docs/guide/made.html', mtimeMs: 3, size: 100, usages: [] },
];

function setup({ unsaved = false, readOnly = false, active = 'content/docs/guide/intro.mdx', current = null }: { unsaved?: boolean; readOnly?: boolean; active?: string | null; current?: string | null } = {}) {
  const change = vi.fn((request: AssetRequest): Promise<AssetAnswer> => {
    if (request.op === 'delete') return Promise.resolve({ changes: [{ type: 'delete', path: request.path }], usages: [] });
    if (request.op === 'replace') return Promise.reject(new Error('the view does not replace'));
    const to = `public/docs/guide/${request.name}.png`;
    return Promise.resolve({
      changes: [
        { type: 'move', path: request.path, to },
        { type: 'change', path: 'content/docs/guide/intro.mdx', detail: '1 reference' },
      ],
      usages: [usage('content/docs/guide/intro.mdx', 9)],
    });
  });
  const client = { listAssets: vi.fn(), change } as unknown as AssetsClient;
  const reload = vi.fn();
  const onOpenUsage = vi.fn();
  const onOpen = vi.fn();
  const onChanged = vi.fn();
  const view = (at: string | null) => (
    <AssetsView
      client={client}
      list={{ assets: ASSETS, error: null, reload }}
      active={active}
      current={at}
      unsaved={unsaved}
      readOnly={readOnly}
      onOpen={onOpen}
      onOpenUsage={onOpenUsage}
      onChanged={onChanged}
    />
  );
  const { rerender } = render(view(current));
  return { change, reload, onOpenUsage, onOpen, onChanged, rerender: (at: string | null) => { rerender(view(at)); } };
}

const row = (name: RegExp) => screen.getByRole('button', { name }).closest<HTMLElement>('.studio-tree-row') ?? document.body;
const openMenu = async (file: string) => {
  await userEvent.click(screen.getByRole('button', { name: `Actions for ${file}` }));
  return screen.getByRole('menu');
};

afterEach(cleanup);

describe('AssetsView', () => {
  it('shows public/docs as folders, opening the open note’s, with each file’s use count', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Collapse guide' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Expand other' })).toBeTruthy();
    expect(within(row(/^flow/)).getByText('2×')).toBeTruthy();
    expect(within(row(/^spare/)).getByText('unused')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^pic/ })).toBeNull();
  });

  it('filters by name and by use', async () => {
    setup({ active: null });
    await userEvent.click(screen.getByRole('button', { name: 'Unused 4' }));
    expect(screen.getByRole('button', { name: /^spare/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^pic/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^flow/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'All 6' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter assets' }), 'FLOW');
    expect(screen.getByRole('button', { name: /^flow/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^spare/ })).toBeNull();
  });

  it('opens a file in the main pane instead of expanding its row, and marks the open one', async () => {
    const { onOpen, rerender } = setup();
    await userEvent.click(screen.getByRole('button', { name: /^flow/ }));
    expect(onOpen).toHaveBeenCalledWith('public/docs/guide/flow.html');
    expect(screen.queryByRole('list', { name: 'Used in' })).toBeNull();
    expect(row(/^flow/).getAttribute('aria-current')).toBeNull();
    rerender('public/docs/guide/flow.html');
    expect(row(/^flow/).getAttribute('aria-current')).toBe('page');
    expect(within(row(/^flow/)).getByText('2×')).toBeTruthy();
    await userEvent.click(within(await openMenu('spare.svg')).getByRole('menuitem', { name: 'Open' }));
    expect(onOpen).toHaveBeenLastCalledWith('public/docs/guide/spare.svg');
  });

  it('opens the folders down to the asset open in the main pane', () => {
    setup({ active: null, current: 'public/docs/other/pic.png' });
    expect(screen.getByRole('button', { name: 'Collapse other' })).toBeTruthy();
    expect(row(/^pic/).getAttribute('aria-current')).toBe('page');
  });

  it('renames with a preview of every file it writes; the extension stays', async () => {
    const { change, reload, onChanged } = setup();
    await userEvent.click(within(await openMenu('old_name.png')).getByRole('menuitem', { name: 'Rename…' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename “old_name.png”' });
    const input = within(dialog).getByRole('textbox', { name: 'File name' });
    expect(within(dialog).getByText('.png')).toBeTruthy();
    // The old name, though not a slug, is no change: nothing to save yet.
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Rename' }).disabled).toBe(true);
    expect(change).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, 'Old Name');
    expect(within(dialog).getByText('Notes get /docs/guide/old-name.png; a query or hash after it stays.')).toBeTruthy();
    await waitFor(() => { expect(within(dialog).getByRole('list', { name: 'Files to write' }).textContent).toContain('content/docs/guide/intro.mdx'); });
    expect(change).toHaveBeenLastCalledWith({ op: 'rename', path: 'public/docs/guide/old_name.png', name: 'old-name', baseMtime: 7 }, true);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    expect(change).toHaveBeenLastCalledWith({ op: 'rename', path: 'public/docs/guide/old_name.png', name: 'old-name', baseMtime: 7 });
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('Renamed to old-name.png; updated 1 reference in 1 note.'); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(reload).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ changes: expect.arrayContaining([{ type: 'move', path: 'public/docs/guide/old_name.png', to: 'public/docs/guide/old-name.png' }]) as unknown }));
  });

  it('shows the extension the server keeps, in lowercase', async () => {
    setup({ active: null });
    await userEvent.click(screen.getByRole('button', { name: 'Expand other' }));
    await userEvent.click(within(await openMenu('Photo.PNG')).getByRole('menuitem', { name: 'Rename…' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'File name' }), ' 2');
    expect(within(dialog).getByText('.png')).toBeTruthy();
    expect(within(dialog).getByText('Notes get /docs/other/photo-2.png; a query or hash after it stays.')).toBeTruthy();
  });

  it('refuses to delete a file still in use, and lists where', async () => {
    const { change, onOpenUsage } = setup();
    await userEvent.click(within(await openMenu('flow.html')).getByRole('menuitem', { name: 'Delete…' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete “flow.html”?' });
    expect(within(dialog).getByRole('alert').textContent).toContain('2 places still use it');
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).toBeNull();
    await userEvent.click(within(within(dialog).getByRole('list', { name: 'Used in' })).getAllByRole('button')[0]);
    expect(onOpenUsage).toHaveBeenCalledWith(ASSETS[0].usages[0]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });

  it('deletes an unused file', async () => {
    const { change } = setup();
    await userEvent.click(within(await openMenu('spare.svg')).getByRole('menuitem', { name: 'Delete…' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(change).toHaveBeenCalledWith({ op: 'delete', path: 'public/docs/guide/spare.svg', baseMtime: 9 });
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('Deleted public/docs/guide/spare.svg.'); });
  });

  it('waits for the open note to be saved before renaming or deleting', async () => {
    setup({ unsaved: true });
    const menu = await openMenu('spare.svg');
    expect(within(menu).getByRole<HTMLButtonElement>('menuitem', { name: 'Rename…' }).disabled).toBe(true);
    expect(within(menu).getByRole<HTMLButtonElement>('menuitem', { name: 'Delete…' }).disabled).toBe(true);
    expect(within(menu).getByText(/unsaved changes/)).toBeTruthy();
    expect(within(menu).getByRole<HTMLButtonElement>('menuitem', { name: 'Open' }).disabled).toBe(false);
  });

  it('leaves only Open in the row menu when read only (main)', async () => {
    const { onOpen } = setup({ readOnly: true });
    const menu = await openMenu('old_name.png');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent.trim())).toEqual(['Open']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith('public/docs/guide/old_name.png');
  });

  it('lists diagrams/ after public/docs, opening a diagram and offering only Open', async () => {
    const diagram: AssetInfo = { path: 'diagrams/guide/flow.diagram.json', mtimeMs: 4, size: 900, usages: [usage('content/docs/guide/intro.mdx', 30)] };
    const onOpen = vi.fn();
    render(
      <AssetsView
        client={{ listAssets: vi.fn(), change: vi.fn() } as unknown as AssetsClient}
        list={{ assets: [...ASSETS, diagram], error: null, reload: vi.fn() }}
        active={null}
        current="diagrams/guide/flow.diagram.json"
        unsaved={false}
        onOpen={onOpen}
        onOpenUsage={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Diagrams' })).toBeTruthy();
    // The diagram's folder opens, as the open asset's does.
    const diagramRow = row(/^flow\.diagram\.json/);
    expect(diagramRow.getAttribute('aria-current')).toBe('page');
    expect(within(diagramRow).getByText('1×')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /^flow\.diagram\.json/ }));
    expect(onOpen).toHaveBeenCalledWith('diagrams/guide/flow.diagram.json');
    const menu = await openMenu('flow.diagram.json');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent.trim())).toEqual(['Open']);
  });
});
