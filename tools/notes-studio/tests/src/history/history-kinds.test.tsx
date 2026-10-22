// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOW, type Comparison, type DeletedRestore, type HistoryClient, type PageHistory } from '../../../src/api/history';
import { HistoryPage } from '../../../src/history/HistoryPage';

afterEach(cleanup);

const sha = (digit: string) => digit.repeat(40);
const ASSET = 'public/notes/demo/pixel.webp';
const OLD_ASSET = 'public/notes/demo/pixel.png';
const PAGE = 'content/notes/shelf/one.mdx';
const binary = (size: number) => ({ kind: 'binary' as const, size });
const text = (value: string) => ({ kind: 'text' as const, text: value, size: value.length });
const version = (digit: string, path: string, message: string, status: 'A' | 'M' | 'R' = 'M') =>
  ({ sha: sha(digit), date: '2026-10-01T10:00:00Z', author: 'Studio Test', message, path, status, inChangeRequest: false });

function clientFor(history: PageHistory, sides: (from: string | null, to: string) => Pick<Comparison, 'before' | 'after'>) {
  return {
    loadHistory: vi.fn(() => Promise.resolve(history)),
    compare: vi.fn((path: string, from: string | null, to: string): Promise<Comparison> => {
      const at = (each: string) => history.versions.find((entry) => entry.sha === each)?.path ?? path;
      return Promise.resolve({ path, from: from === null ? null : { version: from, path: at(from) }, to: { version: to, path: at(to) }, ...sides(from, to) });
    }),
    restore: vi.fn(() => Promise.resolve({ path: OLD_ASSET, mtimeMs: 50 })),
    versionUrl: vi.fn((path: string, at: string) => `/blob/${at.slice(0, 7)}/${path}`),
    restoreDeleted: vi.fn((path: string, _sha: string, dryRun?: boolean): Promise<DeletedRestore> => Promise.resolve({
      path,
      open: path,
      changes: dryRun === true
        ? [{ type: 'add', path }, { type: 'add', path: 'content/notes/shelf/meta.yaml' }, { type: 'change', path: 'content/notes/meta.yaml', detail: 'adds "shelf"' }]
        : [],
    })),
  };
}

describe('HistoryPage: assets', () => {
  const history: PageHistory = {
    path: ASSET,
    mtimeMs: 42,
    deleted: null,
    generated: false,
    versions: [version('c', ASSET, 'docs: pixel as webp', 'R'), version('b', OLD_ASSET, 'docs: second pixel'), version('a', OLD_ASSET, 'docs: add pixel', 'A')],
  };

  it('shows two versions of an image side by side, with their sizes, and opens the asset page', async () => {
    const user = userEvent.setup();
    const client = clientFor(history, (from) => ({ before: from === null ? null : binary(1024), after: binary(2048) }));
    const onOpen = vi.fn();
    render(<HistoryPage client={client as unknown as HistoryClient} path={ASSET} title="pixel.webp" readOnly={false} revision={1} onOpen={onOpen} onRestored={vi.fn()} />);
    await user.click(await screen.findByText('docs: second pixel'));
    const before = await screen.findByAltText('aaaaaaa version');
    expect(before.getAttribute('src')).toBe(`/blob/aaaaaaa/${OLD_ASSET}`);
    expect(screen.getByAltText('bbbbbbb version').closest('figure')?.textContent).toContain('2.0 KB');
    // An image has no source to show.
    expect(screen.queryByRole('tab', { name: 'Source' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Open asset page/ }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('says a version with another extension renames the asset, and follows where the restore put it', async () => {
    const user = userEvent.setup();
    const client = clientFor(history, () => ({ before: binary(10), after: binary(20) }));
    const onRestored = vi.fn();
    render(<HistoryPage client={client as unknown as HistoryClient} path={ASSET} title="pixel.webp" readOnly={false} revision={1} onOpen={vi.fn()} onRestored={onRestored} />);
    await user.click(await screen.findByText('docs: second pixel'));
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Restore this version' });
    expect(dialog.textContent).toContain('This version is a .png file: as with Replace, the asset takes that extension');
    await user.click(within(dialog).getByRole('button', { name: 'Restore bbbbbbb' }));
    expect(client.restore).toHaveBeenCalledWith(ASSET, sha('b'), 42);
    expect(onRestored).toHaveBeenCalledWith(OLD_ASSET);
  });

  it('turns Restore off for an asset a diagram generates, as the asset page turns Replace off', async () => {
    const client = clientFor({ ...history, generated: true }, () => ({ before: binary(10), after: binary(20) }));
    render(<HistoryPage client={client as unknown as HistoryClient} path={ASSET} title="pixel.webp" readOnly={false} revision={1} onOpen={vi.fn()} onRestored={vi.fn()} />);
    await userEvent.setup().click(await screen.findByText('docs: second pixel'));
    const restore = screen.getByRole<HTMLButtonElement>('button', { name: 'Restore' });
    expect(restore.disabled).toBe(true);
    expect(restore.title).toBe('A diagram generates it: change the diagram instead');
  });

  it('shows an SVG source too', async () => {
    const svg = 'public/notes/demo/shape.svg';
    const client = clientFor({ path: svg, mtimeMs: 1, deleted: null, generated: false, versions: [version('b', svg, 'docs: wider'), version('a', svg, 'docs: shape', 'A')] }, (from, to) => ({
      before: from === null ? null : text('<svg width="1"/>'),
      after: text(to === NOW ? '<svg width="3"/>' : '<svg width="2"/>'),
    }));
    render(<HistoryPage client={client as unknown as HistoryClient} path={svg} title="shape.svg" readOnly={false} revision={1} onOpen={vi.fn()} onRestored={vi.fn()} />);
    expect(await screen.findByRole('tab', { name: 'Source' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Preview' })).toBeTruthy();
  });
});

describe('HistoryPage: a deleted page', () => {
  const history: PageHistory = {
    path: PAGE,
    mtimeMs: null,
    generated: false,
    deleted: { sha: sha('f'), date: '2026-10-02T10:00:00Z', author: 'Studio Test', message: 'docs: retire the shelf' },
    versions: [version('b', PAGE, 'docs: second one'), version('a', PAGE, 'docs: add one', 'A')],
  };
  const note = (body: string) => `---\ntitle: One\n---\n\n${body}\n`;

  it('shows the delete on top of the versions, and brings a version back after listing what it writes', async () => {
    const user = userEvent.setup();
    const client = clientFor(history, (from, to) => ({ before: from === null ? null : text(note('First.')), after: text(note(to === sha('b') ? 'Second.' : 'First.')) }));
    const onBroughtBack = vi.fn();
    const onDeletedList = vi.fn();
    render(
      <HistoryPage client={client as unknown as HistoryClient} path={PAGE} title="One" readOnly={false} revision={1} onOpen={vi.fn()} onRestored={vi.fn()} onBroughtBack={onBroughtBack} onDeletedList={onDeletedList} />,
    );
    const list = within(await screen.findByRole('complementary', { name: 'Versions' }));
    expect((await list.findByText('Deleted in fffffff')).closest('button')).toBeNull();
    expect(list.getAllByRole('button').map((item) => item.querySelector('.studio-history-message')?.textContent)).toEqual(['docs: second one', 'docs: add one']);
    expect(screen.getByText('Deleted', { selector: '.studio-history-chip' })).toBeTruthy();
    await user.click(list.getByText('docs: add one'));
    await user.click(screen.getByRole('button', { name: 'Restore page…' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Restore this page' });
    const writes = within(await within(dialog).findByRole('list', { name: 'Files the restore writes' }));
    expect(writes.getAllByRole('listitem').map((item) => item.textContent)).toEqual([`A${PAGE}`, 'Acontent/notes/shelf/meta.yaml', 'Mcontent/notes/meta.yaml: adds "shelf"']);
    expect(dialog.textContent).toContain('Its folder was deleted with it');
    expect(client.restoreDeleted).toHaveBeenCalledWith(PAGE, sha('a'), true);
    await user.click(within(dialog).getByRole('button', { name: 'Restore and open' }));
    await waitFor(() => { expect(onBroughtBack).toHaveBeenCalledWith(PAGE); });
    expect(client.restoreDeleted).toHaveBeenLastCalledWith(PAGE, sha('a'));
    await user.click(screen.getByRole('button', { name: /Deleted pages/ }));
    expect(onDeletedList).toHaveBeenCalled();
  });

  it('does not restore on main', async () => {
    const client = clientFor(history, () => ({ before: null, after: text(note('Second.')) }));
    render(<HistoryPage client={client as unknown as HistoryClient} path={PAGE} title="One" readOnly revision={1} onOpen={vi.fn()} onRestored={vi.fn()} />);
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: 'Restore page…' })).disabled).toBe(true);
  });
});
