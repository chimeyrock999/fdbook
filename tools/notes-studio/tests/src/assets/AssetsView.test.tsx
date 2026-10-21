// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetAnswer, AssetInfo, AssetRequest, AssetsClient, AssetUsage } from '../../../src/api/assets';
import { AssetsView } from '../../../src/assets/AssetsView';

const usage = (note: string, line: number): AssetUsage => ({ note, line, column: 12, length: 20, text: `![x](/notes/guide/${String(line)}.png)`, unsure: false });

const ASSETS: AssetInfo[] = [
  { path: 'public/notes/guide/flow.html', mtimeMs: 5, usages: [usage('content/notes/guide/intro.mdx', 17), usage('content/notes/guide/index.mdx', 40)] },
  { path: 'public/notes/guide/old_name.png', mtimeMs: 7, usages: [usage('content/notes/guide/intro.mdx', 9)] },
  { path: 'public/notes/guide/spare.svg', mtimeMs: 9, usages: [] },
  { path: 'public/notes/other/pic.png', mtimeMs: 1, usages: [] },
  { path: 'public/notes/other/Photo.PNG', mtimeMs: 2, usages: [] },
];

function setup({ unsaved = false, active = 'content/notes/guide/intro.mdx' }: { unsaved?: boolean; active?: string | null } = {}) {
  const change = vi.fn((request: AssetRequest): Promise<AssetAnswer> => {
    if (request.op === 'delete') return Promise.resolve({ changes: [{ type: 'delete', path: request.path }], usages: [] });
    const to = `public/notes/guide/${request.name}.png`;
    return Promise.resolve({
      changes: [
        { type: 'move', path: request.path, to },
        { type: 'change', path: 'content/notes/guide/intro.mdx', detail: '1 reference' },
      ],
      usages: [usage('content/notes/guide/intro.mdx', 9)],
    });
  });
  const client = { listAssets: vi.fn(), change } as unknown as AssetsClient;
  const reload = vi.fn();
  const onOpenUsage = vi.fn();
  render(<AssetsView client={client} list={{ assets: ASSETS, error: null, reload }} active={active} unsaved={unsaved} onOpenUsage={onOpenUsage} />);
  return { change, reload, onOpenUsage };
}

const row = (name: RegExp) => screen.getByRole('button', { name }).closest<HTMLElement>('.studio-tree-row') ?? document.body;
const openMenu = async (file: string) => {
  await userEvent.click(screen.getByRole('button', { name: `Actions for ${file}` }));
  return screen.getByRole('menu');
};

afterEach(cleanup);

describe('AssetsView', () => {
  it('shows public/notes as folders, opening the open note’s, with each file’s use count', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Collapse guide' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Expand other' })).toBeTruthy();
    expect(within(row(/^flow/)).getByText('2×')).toBeTruthy();
    expect(within(row(/^spare/)).getByText('unused')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^pic/ })).toBeNull();
  });

  it('filters by name and by use', async () => {
    setup({ active: null });
    await userEvent.click(screen.getByRole('button', { name: 'Unused 3' }));
    expect(screen.getByRole('button', { name: /^spare/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^pic/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^flow/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'All 5' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter assets' }), 'FLOW');
    expect(screen.getByRole('button', { name: /^flow/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^spare/ })).toBeNull();
  });

  it('lists where a file is used; picking a line opens it', async () => {
    const { onOpenUsage } = setup();
    await userEvent.click(screen.getByRole('button', { name: /^flow/ }));
    const list = screen.getByRole('list', { name: 'Used in' });
    expect(within(list).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'introL17![x](/notes/guide/17.png)',
      'guideL40![x](/notes/guide/40.png)',
    ]);
    await userEvent.click(within(list).getAllByRole('button')[1]);
    expect(onOpenUsage).toHaveBeenCalledWith(ASSETS[0].usages[1]);
  });

  it('renames with a preview of every file it writes; the extension stays', async () => {
    const { change, reload } = setup();
    await userEvent.click(within(await openMenu('old_name.png')).getByRole('menuitem', { name: 'Rename…' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename “old_name.png”' });
    const input = within(dialog).getByRole('textbox', { name: 'File name' });
    expect(within(dialog).getByText('.png')).toBeTruthy();
    // The old name, though not a slug, is no change: nothing to save yet.
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Rename' }).disabled).toBe(true);
    expect(change).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, 'Old Name');
    expect(within(dialog).getByText('Notes get /notes/guide/old-name.png; a query or hash after it stays.')).toBeTruthy();
    await waitFor(() => { expect(within(dialog).getByRole('list', { name: 'Files to write' }).textContent).toContain('content/notes/guide/intro.mdx'); });
    expect(change).toHaveBeenLastCalledWith({ op: 'rename', path: 'public/notes/guide/old_name.png', name: 'old-name', baseMtime: 7 }, true);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    expect(change).toHaveBeenLastCalledWith({ op: 'rename', path: 'public/notes/guide/old_name.png', name: 'old-name', baseMtime: 7 });
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('Renamed to old-name.png; updated 1 reference in 1 note.'); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(reload).toHaveBeenCalled();
  });

  it('shows the extension the server keeps, in lowercase', async () => {
    setup({ active: null });
    await userEvent.click(screen.getByRole('button', { name: 'Expand other' }));
    await userEvent.click(within(await openMenu('Photo.PNG')).getByRole('menuitem', { name: 'Rename…' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'File name' }), ' 2');
    expect(within(dialog).getByText('.png')).toBeTruthy();
    expect(within(dialog).getByText('Notes get /notes/other/photo-2.png; a query or hash after it stays.')).toBeTruthy();
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
    expect(change).toHaveBeenCalledWith({ op: 'delete', path: 'public/notes/guide/spare.svg', baseMtime: 9 });
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('Deleted public/notes/guide/spare.svg.'); });
  });

  it('waits for the open note to be saved before renaming or deleting', async () => {
    setup({ unsaved: true });
    const menu = await openMenu('spare.svg');
    expect(within(menu).getByRole<HTMLButtonElement>('menuitem', { name: 'Rename…' }).disabled).toBe(true);
    expect(within(menu).getByRole<HTMLButtonElement>('menuitem', { name: 'Delete…' }).disabled).toBe(true);
    expect(within(menu).getByText(/unsaved changes/)).toBeTruthy();
    expect(within(menu).getByRole<HTMLButtonElement>('menuitem', { name: 'Show usage' }).disabled).toBe(false);
  });
});
