// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChangesClient, FileDiff } from '../../../src/api/changes';
import { DiffPage, type DiffTarget } from '../../../src/diff/DiffPage';

afterEach(cleanup);

beforeAll(() => {
  // jsdom has no ResizeObserver and lays nothing out: each pane reports 0px
  // once it is observed, as a browser reports the starting size, so Source
  // is one column.
  globalThis.ResizeObserver = class {
    constructor(private readonly report: ResizeObserverCallback) {}
    observe() { this.report([], this); }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
  };
});

// The page's own title, not a heading inside the note.
const titleOf = () => document.querySelector('.studio-asset-page-title h1')?.textContent;
const BASE = '3f9a1c2000000000000000000000000000000000';
const text = (value: string) => ({ kind: 'text' as const, text: value, size: value.length });
const NOTE = 'content/notes/spark/aqe.mdx';
const before = '---\ntitle: AQE\ndescription: Old.\n---\n\n# Adaptive Query Execution\n\nOne.\n\nTwo.\n\nThree.\n\nFour.\n\nAQE is on from Spark 3.0.\n';
const after = '---\ntitle: AQE\ndescription: New.\n---\n\n# Adaptive Query Execution\n\nOne.\n\nTwo.\n\nThree.\n\nFour.\n\nAQE is on from Spark 3.2.\n';
const noteDiff: FileDiff = { path: NOTE, base: BASE, status: 'M', before: text(before), after: text(after) };

function setup(diff: FileDiff | Error, target: DiffTarget = { path: diff instanceof Error ? NOTE : diff.path }) {
  const loadDiff = vi.fn(() => (diff instanceof Error ? Promise.reject(diff) : Promise.resolve(diff)));
  const client = { loadDiff, baseFileUrl: (path: string, sha: string) => `/blob/${path}@${sha}` } as unknown as ChangesClient;
  const props = { onOpen: vi.fn(), onBack: vi.fn() };
  const titles = new Map([[NOTE, 'Adaptive Query Execution'], ['content/notes/spark/meta.yaml', 'Spark']]);
  const view = render(<DiffPage client={client} target={target} revision={1} titles={titles} {...props} />);
  return { ...props, loadDiff, client, titles, view };
}

describe('DiffPage', () => {
  it('renders a note: changed frontmatter keys, removed blocks over added ones, unchanged ones folded', async () => {
    const { onOpen } = setup(noteDiff);
    expect(await screen.findByText(/Against main at merge base 3f9a1c2/)).toBeTruthy();
    expect(titleOf()).toBe('Adaptive Query ExecutionM');
    const frontmatter = screen.getByRole('table');
    expect(within(frontmatter).getByRole('rowheader').textContent).toBe('description');
    expect(frontmatter.querySelector('del')?.textContent).toBe('Old.');
    expect(frontmatter.querySelector('ins')?.textContent).toBe('New.');
    await waitFor(() => { expect(screen.getByRole('region', { name: 'Removed' }).textContent).toContain('AQE is on from Spark 3.0.'); });
    await waitFor(() => { expect(screen.getByRole('region', { name: 'Added' }).textContent).toContain('AQE is on from Spark 3.2.'); });
    // The live editor replaces the static first paint once the page is idle
    // (200 ms in jsdom): wait for it, so what it asks of the window
    // (matchMedia) runs in every run, not only in a slow one.
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Added' }).querySelector('.ProseMirror[contenteditable]')).not.toBeNull();
    }, { timeout: 10_000 });
    // The heading and Four. stay as context; One. to Three. fold.
    const fold = screen.getByRole('button', { name: '3 unchanged blocks · show' });
    expect(screen.queryByText('Two.')).toBeNull();
    await userEvent.click(fold);
    await waitFor(() => { expect(screen.getByText('Two.')).toBeTruthy(); });
    await userEvent.click(screen.getByRole('button', { name: /Open in editor/ }));
    expect(onOpen).toHaveBeenCalledWith(NOTE);
  }, 20_000);

  it('shows the raw diff in Source, in one column in a narrow pane', async () => {
    setup(noteDiff);
    await userEvent.click(await screen.findByRole('tab', { name: 'Source' }));
    const source = screen.getByTestId('source-diff');
    expect(source.dataset.layout).toBe('unified');
    await waitFor(() => { expect(source.querySelector('.cm-deletedChunk')?.textContent).toContain('description: Old.'); });
    expect(source.textContent).toContain('description: New.');
    expect(screen.getByRole('tab', { name: 'Source' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows a meta.yaml as its source only, with no editor to open', async () => {
    setup({ path: 'content/notes/spark/meta.yaml', base: BASE, status: 'M', before: text('pages:\n  - aqe\n'), after: text('pages:\n  - aqe\n  - joins\n') });
    expect(await screen.findByTestId('source-diff')).toBeTruthy();
    expect(titleOf()).toBe('Page order of SparkM');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: /Open in editor/ })).toBeNull();
  });

  it('previews an image on main and now, and a deleted one with nothing after it', async () => {
    const image = 'public/notes/spark/aqe/flow.png';
    const first = setup({ path: image, base: BASE, status: 'M', before: { kind: 'binary', size: 2048 }, after: { kind: 'binary', size: 4096 } });
    const figures = await screen.findAllByRole('figure');
    expect(figures.map((figure) => figure.querySelector('figcaption')?.textContent)).toEqual(['Main2.0 KB', 'Now4.0 KB']);
    expect(screen.getByRole<HTMLImageElement>('img', { name: 'Main version' }).getAttribute('src')).toBe(`/blob/${image}@${BASE}`);
    expect(screen.getByRole<HTMLImageElement>('img', { name: 'Now version' }).getAttribute('src')).toBe(`/api/file?path=${encodeURIComponent(image)}`);
    expect(screen.queryByRole('tablist')).toBeNull();
    first.view.unmount();
    setup({ path: image, base: BASE, status: 'D', before: { kind: 'binary', size: 2048 }, after: null });
    expect(await screen.findByText('Deleted in this change request.')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Now version' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open in editor/ })).toBeNull();
  });

  it('gives an SVG both a preview and its source', async () => {
    setup({ path: 'public/notes/spark/shape.svg', base: BASE, status: 'M', before: text('<svg/>'), after: text('<svg></svg>') });
    expect((await screen.findAllByRole('tab')).map((tab) => tab.textContent)).toEqual(['Preview', 'Source']);
  });

  it('says a new note is not on main, and renders it all as added', async () => {
    setup({ path: NOTE, base: BASE, status: 'A', before: null, after: text(after) });
    expect(await screen.findByText('Not on main (merge base 3f9a1c2): new in this change request.')).toBeTruthy();
    await waitFor(() => { expect(screen.getAllByRole('region', { name: 'Added' }).length).toBeGreaterThan(0); });
    expect(screen.queryByRole('region', { name: 'Removed' })).toBeNull();
  });

  it('offers Source when a side does not parse', async () => {
    setup({ ...noteDiff, after: text(`${after}\n<Broken\n`) });
    expect((await screen.findByRole('alert')).textContent).toContain('does not parse');
    await userEvent.click(screen.getByRole('button', { name: 'Show Source' }));
    expect(screen.getByTestId('source-diff')).toBeTruthy();
  });

  it('says a note too large to send as text is too large, with its sizes', async () => {
    setup({ ...noteDiff, before: { kind: 'binary', size: 3 * 1024 * 1024 }, after: text(after) });
    expect((await screen.findByText(/Too large to compare here/)).textContent).toBe('Too large to compare here: 3.0 MB on main, 119 B now.');
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('says why the diff could not load', async () => {
    setup(new Error('not an editable path: x'));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not load the diff: not an editable path: x');
  });

  it('names a rename with both paths and asks for it under its old name', async () => {
    const { loadDiff } = setup({ path: 'content/notes/spark/adaptive.mdx', from: NOTE, base: BASE, status: 'R', before: text(before), after: text(before) }, { path: 'content/notes/spark/adaptive.mdx', from: NOTE });
    expect(await screen.findByText(`${NOTE} → content/notes/spark/adaptive.mdx`)).toBeTruthy();
    expect(loadDiff).toHaveBeenCalledWith('content/notes/spark/adaptive.mdx', NOTE);
  });

  it('names a rename the server found, though the request had no old name', async () => {
    setup({ path: 'content/notes/spark/adaptive.mdx', from: NOTE, base: BASE, status: 'R', before: text(before), after: text(after) }, { path: 'content/notes/spark/adaptive.mdx' });
    expect(await screen.findByText(`${NOTE} → content/notes/spark/adaptive.mdx`)).toBeTruthy();
  });

  it('loads again when the changes do, and goes back to the list', async () => {
    const { loadDiff, client, titles, view, onBack, onOpen } = setup(noteDiff);
    await screen.findByText(/Against main/);
    view.rerender(<DiffPage client={client} target={{ path: NOTE }} revision={2} titles={titles} onOpen={onOpen} onBack={onBack} />);
    await waitFor(() => { expect(loadDiff).toHaveBeenCalledTimes(2); });
    await userEvent.click(screen.getByRole('button', { name: /Changes/ }));
    expect(onBack).toHaveBeenCalled();
  });
});
