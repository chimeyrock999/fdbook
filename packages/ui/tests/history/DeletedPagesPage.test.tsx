// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeletedPage } from '#api/history.ts';
import { DeletedPagesPage } from '#history/DeletedPagesPage.tsx';
import { groupDeleted } from '#history/versions.ts';

afterEach(cleanup);

const deleted = (path: string, title: string, digit: string, folderGone = false): DeletedPage =>
  ({ path, title, sha: digit.repeat(40), date: '2026-10-01T10:00:00Z', author: 'Studio Test', message: `drop ${digit}`, folderGone, committed: true });
const pages = [
  deleted('content/docs/shelf/one.mdx', 'Shelf one', 'b', true),
  deleted('content/docs/shelf/two.mdx', 'Shelf two', 'b', true),
  deleted('content/docs/lab/beta.mdx', 'Beta', 'a'),
];

describe('DeletedPagesPage', () => {
  it('groups the pages by the commit that deleted them, in order', () => {
    expect(groupDeleted(pages).map((group) => [group.message, group.pages.map((page) => page.title)])).toEqual([
      ['drop b', ['Shelf one', 'Shelf two']],
      ['drop a', ['Beta']],
    ]);
  });

  it('lists the pages, marks a deleted folder, filters, and opens a page history', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<DeletedPagesPage pages={pages} error={null} readOnly={false} onOpen={onOpen} />);
    const page = within(screen.getByRole('region', { name: 'Deleted pages' }));
    expect(page.getByText('3')).toBeTruthy();
    expect(page.getAllByText('Folder deleted')).toHaveLength(2);
    await user.type(page.getByLabelText('Filter deleted pages'), 'lab/');
    expect(page.queryByText('Shelf one')).toBeNull();
    await user.click(page.getByText('Beta'));
    expect(onOpen).toHaveBeenCalledWith('content/docs/lab/beta.mdx');
  });

  it('puts the deletes not committed yet first, in one group', () => {
    const pending = { ...deleted('content/docs/lab/alpha.mdx', 'Alpha', 'c'), committed: false };
    const other = { ...deleted('content/docs/lab/gamma.mdx', 'Gamma', 'd'), committed: false };
    expect(groupDeleted([pending, other, ...pages]).map((group) => [group.committed, group.pages.map((page) => page.title)])).toEqual([
      [false, ['Alpha', 'Gamma']],
      [true, ['Shelf one', 'Shelf two']],
      [true, ['Beta']],
    ]);
    render(<DeletedPagesPage pages={[pending, ...pages]} error={null} readOnly={false} onOpen={vi.fn()} />);
    expect(screen.getByText('Not committed')).toBeTruthy();
  });

  it('says when nothing was deleted, and when the list failed', () => {
    const { rerender } = render(<DeletedPagesPage pages={[]} error={null} readOnly onOpen={vi.fn()} />);
    expect(screen.getByText('No page was deleted.')).toBeTruthy();
    rerender(<DeletedPagesPage pages={null} error="git log failed" readOnly onOpen={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('git log failed');
  });
});
