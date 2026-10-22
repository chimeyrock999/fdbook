// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NOW, type Comparison, type HistoryClient, type PageHistory } from '../../../src/api/history';
import { HistoryPage } from '../../../src/history/HistoryPage';

afterEach(cleanup);

beforeAll(() => {
  globalThis.ResizeObserver = class {
    constructor(private readonly report: ResizeObserverCallback) {}
    observe() { this.report([], this); }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
  };
});

const PAGE = 'content/notes/streaming/groups.mdx';
const OLD = 'content/notes/streaming/group.mdx';
const sha = (digit: string) => digit.repeat(40);
const note = (body: string) => `---\ntitle: Groups\n---\n\n${body}\n`;
const contents: Record<string, string> = { [NOW]: note('Now.'), [sha('d')]: note('Fourth.'), [sha('c')]: note('Third.'), [sha('b')]: note('Second.'), [sha('a')]: note('First.') };
const text = (value: string) => ({ kind: 'text' as const, text: value, size: value.length });

const pageHistory: PageHistory = {
  path: PAGE,
  mtimeMs: 42,
  deleted: null,
  generated: false,
  versions: [
    { sha: sha('c'), date: '2026-10-20T10:00:00Z', author: 'Studio Test', message: 'docs: third', path: PAGE, status: 'M', inChangeRequest: true },
    { sha: sha('b'), date: '2026-10-10T10:00:00Z', author: 'Studio Test', message: 'docs: rename', path: PAGE, status: 'R', from: OLD, inChangeRequest: false },
    { sha: sha('a'), date: '2026-10-01T10:00:00Z', author: 'Studio Test', message: 'docs: first', path: OLD, status: 'A', inChangeRequest: false },
  ],
};

function setup({ readOnly = false, restore = () => Promise.resolve({ path: PAGE, mtimeMs: 43 }) }: { readOnly?: boolean; restore?: () => Promise<unknown> } = {}) {
  const client = {
    loadHistory: vi.fn(() => Promise.resolve(pageHistory)),
    compare: vi.fn((path: string, from: string | null, to: string): Promise<Comparison> => Promise.resolve({
      path,
      from: from === null ? null : { version: from, path },
      to: { version: to, path },
      before: from === null ? null : text(contents[from]),
      after: text(contents[to]),
    })),
    restore: vi.fn(restore),
  };
  const props = { onOpen: vi.fn(), onRestored: vi.fn() };
  const page = (revision: number) => <HistoryPage client={client as unknown as HistoryClient} path={PAGE} title="Groups" readOnly={readOnly} revision={revision} {...props} />;
  const view = render(page(1));
  // The changes moved (a save, a commit): the history loads again.
  const moved = (revision: number) => { view.rerender(page(revision)); };
  return { client, moved, ...props };
}

const versions = async () => within(await screen.findByRole('complementary', { name: 'Versions' }));

describe('HistoryPage', () => {
  it('lists Now and the versions, marks the change request own and the rename, and shows the newest against the one before', async () => {
    const { client } = setup();
    await waitFor(() => { expect(client.compare).toHaveBeenCalledWith(PAGE, sha('b'), sha('c')); });
    const items = (await versions()).getAllByRole('button');
    expect(items.map((item) => item.querySelector('.studio-history-message')?.textContent)).toEqual(['Now', 'docs: third', 'docs: rename', 'docs: first']);
    expect(items[1].getAttribute('aria-current')).toBe('true');
    expect(within(items[1]).getByText('In this CR')).toBeTruthy();
    expect(within(items[2]).getByText('Renamed from group.mdx')).toBeTruthy();
    expect(within(items[3]).getByText('Created')).toBeTruthy();
    await waitFor(() => { expect(screen.getByRole('region', { name: 'Added' }).textContent).toContain('Third.'); });
    expect(screen.getByRole('region', { name: 'Removed' }).textContent).toContain('Second.');
  });

  it('compares a version with any other, and the first one with nothing', async () => {
    const user = userEvent.setup();
    const { client } = setup();
    await user.click(await (await versions()).findByText('docs: first'));
    await waitFor(() => { expect(client.compare).toHaveBeenLastCalledWith(PAGE, null, sha('a')); });
    expect(screen.getByText(OLD)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Compare with'), NOW);
    await waitFor(() => { expect(client.compare).toHaveBeenLastCalledWith(PAGE, NOW, sha('a')); });
    await user.click(screen.getByRole('tab', { name: 'Source' }));
    expect(document.querySelector('.studio-source-diff')).toBeTruthy();
  });

  it('restores the picked version after a confirm, then shows Now against the version before it', async () => {
    const user = userEvent.setup();
    const { client, onRestored } = setup();
    await user.click(await (await versions()).findByText('docs: first'));
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Restore this version' });
    // The history read again holds the mtime the restore wrote.
    client.loadHistory.mockResolvedValue({ ...pageHistory, mtimeMs: 43 });
    await user.click(within(dialog).getByRole('button', { name: 'Restore aaaaaaa' }));
    expect(client.restore).toHaveBeenCalledWith(PAGE, sha('a'), 42);
    expect(onRestored).toHaveBeenCalledWith(PAGE);
    expect((await screen.findByRole('status')).textContent).toContain('Restored aaaaaaa');
    expect((await versions()).getAllByRole('button')[0].getAttribute('aria-current')).toBe('true');
    await waitFor(() => { expect(client.compare).toHaveBeenLastCalledWith(PAGE, sha('c'), NOW); });
    expect(client.loadHistory).toHaveBeenCalledTimes(2);
  });

  it('drops the restored label once the page moved on', async () => {
    const user = userEvent.setup();
    const { client, moved } = setup();
    await user.click(await (await versions()).findByText('docs: first'));
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    client.loadHistory.mockResolvedValue({ ...pageHistory, mtimeMs: 43 });
    await user.click(screen.getByRole('button', { name: 'Restore aaaaaaa' }));
    expect(await (await versions()).findByText('Restored to aaaaaaa, not committed')).toBeTruthy();
    // An edit since (another mtime) is past it.
    client.loadHistory.mockResolvedValue({ ...pageHistory, mtimeMs: 44 });
    moved(2);
    expect(await (await versions()).findByText('Now')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    // So is a commit: a new newest version, the page left as the restore wrote it.
    client.loadHistory.mockResolvedValue({ ...pageHistory, mtimeMs: 43, versions: [{ ...pageHistory.versions[0], sha: sha('d') }, ...pageHistory.versions] });
    moved(3);
    expect(await (await versions()).findByText('Now')).toBeTruthy();
  });

  it('shows a page not committed yet as Now alone', async () => {
    const client = {
      loadHistory: vi.fn(() => Promise.resolve({ path: PAGE, mtimeMs: 42, versions: [] })),
      compare: vi.fn(() => Promise.resolve({ path: PAGE, from: null, to: { version: NOW, path: PAGE }, before: null, after: text(contents[NOW]) })),
      restore: vi.fn(),
    };
    render(<HistoryPage client={client as unknown as HistoryClient} path={PAGE} title="Groups" readOnly={false} revision={1} onOpen={vi.fn()} onRestored={vi.fn()} />);
    expect((await (await versions()).findAllByRole('button')).map((item) => item.getAttribute('aria-current'))).toEqual(['true']);
    await waitFor(() => { expect(client.compare).toHaveBeenCalledWith(PAGE, null, NOW); });
  });

  it('clears a failed comparison once another one loads', async () => {
    const user = userEvent.setup();
    const { client } = setup();
    await waitFor(() => { expect(client.compare).toHaveBeenCalledTimes(1); });
    client.compare.mockRejectedValueOnce(new Error('git log failed'));
    await user.click(await (await versions()).findByText('docs: rename'));
    expect((await screen.findByRole('alert')).textContent).toBe('git log failed');
    await user.click((await versions()).getByText('docs: first'));
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull(); });
  });

  it('keeps the page when a restore is refused, and says why', async () => {
    const user = userEvent.setup();
    const { onRestored } = setup({ restore: () => Promise.reject(new Error(`${PAGE} changed on disk since it was read`)) });
    await user.click(await (await versions()).findByText('docs: first'));
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    await user.click(screen.getByRole('button', { name: 'Restore aaaaaaa' }));
    expect((await screen.findByRole('alert')).textContent).toContain('changed on disk since it was read');
    expect(onRestored).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('has no Now and no restore on main, and no restore of Now', async () => {
    const user = userEvent.setup();
    setup({ readOnly: true });
    expect((await (await versions()).findAllByRole('button')).map((item) => item.querySelector('.studio-history-message')?.textContent)).toEqual(['docs: third', 'docs: rename', 'docs: first']);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Restore' }).disabled).toBe(true);
    expect(screen.getByText('Main is read only: use Edit to restore in a change request.')).toBeTruthy();
    cleanup();
    setup();
    await user.click(await (await versions()).findByText('Now'));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Restore' }).disabled).toBe(true);
  });
});
