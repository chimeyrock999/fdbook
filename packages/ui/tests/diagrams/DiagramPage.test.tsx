// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { assetChanged } from '#api/asset-versions.ts';
import type { AssetUsage } from '#api/assets.ts';
import { FileConflictError, type createFilesClient } from '#api/files.ts';
import { DiagramPage } from '#diagrams/DiagramPage.tsx';
import { useLeftEdits } from '#diagrams/useDiagramFile.ts';
import { stubLayout } from '#tests/support/visual-editor.tsx';

const PATH = 'diagrams/data-platform/processing/apache-spark/spark-logic-to-execution.diagram.json';
// The repository root, from studio/tests/src/diagrams.
const real = readFileSync(join(import.meta.dirname, '../../../..', PATH), 'utf8');
type Doc = { nodes: { id: string; label: string }[]; edges: { id: string; from: string; to: string }[]; layout: { nodes: Record<string, { x: number; y: number }>; edges?: Record<string, { via?: number[][]; fromSide?: string; toSide?: string }> } };

const USAGE: AssetUsage = { note: 'content/docs/data-platform/processing/apache-spark/index.mdx', line: 12, column: 14, length: 20, text: '<Diagram src="…" />', unsure: false };

// jsdom lays out no text: CodeMirror measures ranges.
beforeAll(stubLayout);

afterEach(() => {
  cleanup();
});

let changes = 0;

// The file API over one file on a pretend disk: a write from a stale mtime
// is a conflict, as the server answers.
function disk(content = real) {
  const state = { content, mtimeMs: 1, gone: false };
  const writes: string[] = [];
  const readFile = vi.fn(() => (state.gone ? Promise.reject(new Error('no such file')) : Promise.resolve({ path: PATH, content: state.content, mtimeMs: state.mtimeMs })));
  const writeFile = vi.fn((path: string, text: string, baseMtime: number | null) => {
    if (baseMtime !== (state.gone ? null : state.mtimeMs)) return Promise.reject(new FileConflictError(path, state.gone ? null : { content: state.content, mtimeMs: state.mtimeMs }));
    state.gone = false;
    state.content = text;
    state.mtimeMs += 1;
    writes.push(text);
    return Promise.resolve(state.mtimeMs);
  });
  const files = { readFile, writeFile } as unknown as ReturnType<typeof createFilesClient>;
  // A change made elsewhere: an agent or the CLI.
  const elsewhere = (text: string) => {
    state.content = text;
    // Unique across tests: the versions assetChanged keeps are the page's, not a test's.
    changes += 1;
    state.mtimeMs = 1000 * changes;
    act(() => { assetChanged(PATH, state.mtimeMs); });
  };
  const last = () => JSON.parse(writes.at(-1) ?? 'null') as Doc;
  return { files, writeFile, writes, last, elsewhere, state };
}

async function open(options: { readOnly?: boolean; content?: string } = {}) {
  const fake = disk(options.content);
  const onOpenUsage = vi.fn();
  const { container } = render(<DiagramPage files={fake.files} path={PATH} readOnly={options.readOnly ?? false} usages={[USAGE]} onOpenUsage={onOpenUsage} />);
  await waitFor(() => { expect(container.querySelector('svg.dg-svg')).not.toBeNull(); });
  return { ...fake, container, onOpenUsage };
}

// The one element `selector` finds, failing the test when there is none.
function one(container: ParentNode, selector: string): Element {
  const found = container.querySelector(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
}
const node = (container: HTMLElement, id: string) => one(container, `.dg-svg [data-node-id="${id}"]`);
const hit = (container: HTMLElement, selector: string) => one(container, `.studio-dg-overlay ${selector}`);
// The JSON view's editor.
function jsonView() {
  const view = EditorView.findFromDOM(one(screen.getByTestId('diagram-json'), '.cm-editor') as HTMLElement);
  if (!view) throw new Error('no JSON editor');
  return view;
}
// A file that does not parse opens in the JSON view. Its status shows on the
// first render, but the editor is created in an effect after it, so wait for
// both (#149).
async function brokenFileOpened() {
  await waitFor(() => {
    expect(screen.getByRole('status').textContent).toBe('Not valid JSON');
    jsonView();
  });
}

// A press, a move and a release, in SVG units (jsdom lays nothing out, so
// the canvas maps client pixels one to one).
function drag(target: Element, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(target, { button: 0, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(window, { clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(window, { clientX: to[0], clientY: to[1] });
}

const click = (target: Element) => { drag(target, [0, 0], [0, 0]); };

describe('DiagramPage', () => {
  it('draws the file with the site renderer, with the notes that use it', async () => {
    const { container, onOpenUsage } = await open();
    expect(container.querySelectorAll('.dg-svg [data-node-id]')).toHaveLength(6);
    expect(screen.getByRole('status').textContent).toBe('Saved');
    await userEvent.click(screen.getByRole('button', { name: /apache-spark\/index\.mdx:12/ }));
    expect(onOpenUsage).toHaveBeenCalledWith(USAGE);
  });

  it('drags a node onto the grid and saves it, and Undo puts it back', async () => {
    const { container, writeFile, last } = await open();
    drag(node(container, 'plan'), [600, 150], [643, 161]);
    await waitFor(() => { expect(writeFile).toHaveBeenCalledTimes(1); });
    expect(last().layout.nodes.plan).toEqual({ x: 600, y: 128, w: 190, h: 68 });
    expect(writeFile.mock.calls[0][2]).toBe(1);
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('Saved'); });
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => { expect(writeFile).toHaveBeenCalledTimes(2); });
    expect(last().layout.nodes.plan).toEqual({ x: 560, y: 120, w: 190, h: 68 });
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(() => { expect(last().layout.nodes.plan.x).toBe(600); });
  });

  it('moves every node of a dragged frame', async () => {
    const { container, last } = await open();
    const frame = one(container, '.dg-svg rect[data-group-id]');
    drag(frame, [700, 260], [740, 260]);
    // The first node lands on the grid (300 + 40 → 344), the rest keep their spacing.
    await waitFor(() => { expect(last().layout.nodes.ops.x).toBe(344); });
    expect(last().layout.nodes.units.x).toBe(864);
    expect(last().layout.nodes.logic.x).toBe(40);
  });

  it('connects a node to another by dragging from its side handle', async () => {
    const { container, last } = await open();
    click(node(container, 'logic'));
    drag(hit(container, '[data-port="bottom"]'), [135, 188], [900, 480]);
    await waitFor(() => { expect(last().edges.at(-1)).toEqual({ id: 'logic-executors', from: 'logic', to: 'executors' }); });
    expect(last().layout.edges?.['logic-executors']).toEqual({ fromSide: 'bottom', toSide: 'top' });
    // The new edge is selected: its properties show.
    expect(screen.getByText('Edge logic → executors')).toBeTruthy();
  });

  it('bends an edge from the middle of a segment, and routes it again', async () => {
    const { container, last } = await open();
    click(hit(container, '[data-hit-edge="submit"]'));
    const insert = hit(container, '[data-insert="0"]');
    drag(insert, [265, 154], [265, 90]);
    await waitFor(() => { expect(last().layout.edges?.submit.via).toEqual([[264, 88]]); });
    await userEvent.click(screen.getByRole('button', { name: 'Route it again' }));
    await waitFor(() => { expect(last().layout.edges?.submit).toBeUndefined(); });
  });

  it('changes an edge’s variant and a node’s label from the panel', async () => {
    const { container, last } = await open();
    click(hit(container, '[data-hit-edge="submit"]'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Variant' }), 'alert');
    await waitFor(() => { expect(last().edges[0]).toMatchObject({ id: 'submit', variant: 'alert' }); });
    click(node(container, 'plan'));
    const label = screen.getByRole('textbox', { name: 'Label' });
    await userEvent.clear(label);
    await userEvent.type(label, 'Logical plan v2{Enter}');
    await waitFor(() => { expect(last().nodes.find((each) => each.id === 'plan')?.label).toBe('Logical plan v2'); });
    expect(container.querySelector('.dg-svg [data-node-id="plan"]')?.textContent).toContain('Logical plan v2');
  });

  it('gives a node a new kind and edits the kind for every node of it', async () => {
    const { container, last } = await open();
    click(node(container, 'plan'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'New kind…');
    await waitFor(() => { expect(last().nodes.find((each) => each.id === 'plan')).toMatchObject({ kind: 'kind' }); });
    const name = screen.getByRole('textbox', { name: 'Name of every New kind' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Plan stage{Enter}');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tone of every Plan stage' }), 'gold');
    await waitFor(() => { expect((last() as unknown as { kinds: unknown[] }).kinds.at(-1)).toEqual({ id: 'kind', label: 'Plan stage', tone: 'gold' }); });
    expect(one(container, '.dg-svg [data-legend]').textContent).toContain('Plan stage');
  });

  it('lists the kinds with no selection; only an unused one can go', async () => {
    const { container, last } = await open();
    click(one(container, '.studio-dg-canvas'));
    expect(screen.getByRole('button', { name: 'Remove the kind Backend' })).toHaveProperty('disabled', true);
    await userEvent.click(screen.getByRole('button', { name: 'Add a kind' }));
    await waitFor(() => { expect(screen.getByRole('group', { name: 'Kind New kind' })).toBeTruthy(); });
    await userEvent.click(screen.getByRole('button', { name: 'Remove the kind New kind' }));
    await waitFor(() => { expect((last() as unknown as { kinds: { id: string }[] }).kinds.map((kind) => kind.id)).toEqual(['backend', 'message-bus', 'external']); });
  });

  it('adds, duplicates and deletes nodes from the toolbar and the keyboard', async () => {
    const { container, last } = await open();
    await userEvent.click(screen.getByRole('button', { name: 'Add a node' }));
    await waitFor(() => { expect(last().nodes.at(-1)).toMatchObject({ id: 'node', label: 'New node' }); });
    click(node(container, 'plan'));
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => { expect(last().nodes.map((each) => each.id)).toContain('plan-2'); });
    fireEvent.keyDown(one(container, '.studio-dg-canvas'), { key: 'Delete' });
    await waitFor(() => { expect(last().nodes.map((each) => each.id)).not.toContain('plan-2'); });
    expect(last().nodes.map((each) => each.id)).toContain('plan');
  });

  it('wraps the selected nodes in a frame', async () => {
    const { container, last } = await open();
    click(node(container, 'logic'));
    fireEvent.pointerDown(node(container, 'ops'), { button: 0, shiftKey: true });
    fireEvent.pointerUp(window);
    await userEvent.click(screen.getByRole('button', { name: 'Add a frame' }));
    await waitFor(() => { expect((last() as unknown as { groups: { id: string; members: string[] }[] }).groups.at(-1)).toEqual({ id: 'frame', label: 'New frame', members: ['logic', 'ops'] }); });
  });

  it('loads a change made on disk while nothing waits to be saved', async () => {
    const { container, writeFile, elsewhere } = await open();
    const changed = JSON.parse(real) as Doc;
    changed.nodes[0].label = 'Changed by an agent';
    elsewhere(JSON.stringify(changed));
    await waitFor(() => { expect(node(container, 'logic').textContent).toContain('Changed by an agent'); });
    expect(writeFile).not.toHaveBeenCalled();
    // Undo goes back to before the change on disk.
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => { expect(node(container, 'logic').textContent).not.toContain('Changed by an agent'); });
  });

  it('asks what to keep when the disk changed under edits not saved', async () => {
    const { container, state } = await open();
    const changed = JSON.parse(real) as Doc;
    changed.nodes[0].label = 'Changed by an agent';
    // The disk moves on before this page's save goes out.
    state.content = JSON.stringify(changed);
    state.mtimeMs = 99;
    drag(node(container, 'plan'), [600, 150], [643, 150]);
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('changed on disk'); });
    await userEvent.click(screen.getByRole('button', { name: 'Load from disk' }));
    await waitFor(() => { expect(node(container, 'logic').textContent).toContain('Changed by an agent'); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('writes this page’s version over the disk on Keep mine', async () => {
    const { container, state, last } = await open();
    state.mtimeMs = 99;
    drag(node(container, 'plan'), [600, 150], [643, 150]);
    await waitFor(() => { expect(screen.getByRole('alert')).toBeTruthy(); });
    await userEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    await waitFor(() => { expect(last().layout.nodes.plan.x).toBe(600); });
    expect(state.mtimeMs).toBe(100);
  });

  it('shows the JSON beside the drawing', async () => {
    const { container } = await open();
    await userEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const json = () => jsonView().state.doc.toString();
    await waitFor(() => { expect(json()).toBe(real); });
    drag(node(container, 'plan'), [600, 150], [643, 150]);
    await waitFor(() => { expect(json()).toContain('"plan": { "x": 600, "y": 120'); });
  });

  it('resizes the JSON under the drawing, and keeps the height', async () => {
    Element.prototype.setPointerCapture = vi.fn();
    const { container } = await open();
    await userEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const column = one(container, '.studio-dg-left') as HTMLElement;
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 800, 800));
    const bar = screen.getByRole('separator', { name: 'Resize the JSON' });
    const pane = () => (one(container, '.studio-dg-json-pane') as HTMLElement).style.height;
    expect(pane()).toBe('');
    fireEvent.pointerDown(bar, { button: 0, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(bar, { pointerId: 1 });
    expect(pane()).toBe('600px');
    // The drawing keeps its minimum.
    fireEvent.keyDown(bar, { key: 'ArrowUp', shiftKey: true });
    expect(pane()).toBe('680px');
    expect(localStorage.getItem('studio-diagram-json-height')).toBe('680');
    fireEvent.doubleClick(bar);
    expect(pane()).toBe('');
    expect(localStorage.getItem('studio-diagram-json-height')).toBeNull();
  });

  it('draws what is typed in the JSON once it parses, and saves it', async () => {
    const { container, last } = await open();
    await userEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const view = jsonView();
    const at = real.indexOf('"Logical plan"');
    act(() => { view.dispatch({ changes: { from: at, to: at + '"Logical plan"'.length, insert: '"Typed plan' } }); });
    expect(screen.getByRole('status').textContent).toBe('Not valid JSON');
    act(() => { view.dispatch({ changes: { from: at + '"Typed plan'.length, insert: '"' } }); });
    await waitFor(() => { expect(node(container, 'plan').textContent).toContain('Typed plan'); });
    await waitFor(() => { expect(last().nodes.find((each) => each.id === 'plan')?.label).toBe('Typed plan'); });
  });

  it('only shows on main or to a reader', async () => {
    const { container, writeFile } = await open({ readOnly: true });
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Read only');
    drag(node(container, 'plan'), [600, 150], [643, 150]);
    fireEvent.doubleClick(one(container, '.studio-dg-canvas'));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('commits a field being edited before a drag on the canvas', async () => {
    const { container, last } = await open();
    click(node(container, 'plan'));
    const label = screen.getByRole('textbox', { name: 'Label' });
    await userEvent.clear(label);
    await userEvent.type(label, 'Renamed');
    drag(node(container, 'ops'), [380, 150], [380, 150]);
    await waitFor(() => { expect(last().nodes.find((each) => each.id === 'plan')?.label).toBe('Renamed'); });
  });

  it('opens a file that is not JSON in the JSON view, to fix it there', async () => {
    const fake = disk('{ "version": 1,');
    render(<DiagramPage files={fake.files} path={PATH} readOnly={false} usages={[]} onOpenUsage={vi.fn()} />);
    await brokenFileOpened();
    act(() => { jsonView().dispatch({ changes: { from: 0, to: 15, insert: real } }); });
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('Saved'); });
    expect(fake.writes).toEqual([real]);
  });

  it('leaves keys pressed outside the page alone', async () => {
    const { container, writeFile } = await open();
    click(node(container, 'plan'));
    fireEvent.keyDown(document.body, { key: 'Delete' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(writeFile).not.toHaveBeenCalled();
    fireEvent.keyDown(one(container, '.studio-dg-canvas'), { key: 'ArrowRight' });
    await waitFor(() => { expect(writeFile).toHaveBeenCalledTimes(1); });
  });

  it('keeps the JSON view open once a broken file parses', async () => {
    const fake = disk('{ "version": 1,');
    const { container } = render(<DiagramPage files={fake.files} path={PATH} readOnly={false} usages={[]} onOpenUsage={vi.fn()} />);
    await brokenFileOpened();
    act(() => { jsonView().dispatch({ changes: { from: 0, to: 15, insert: real } }); });
    await waitFor(() => { expect(container.querySelector('svg.dg-svg')).not.toBeNull(); });
    expect(screen.getByRole('button', { name: 'JSON' }).getAttribute('aria-pressed')).toBe('true');
    expect(jsonView().state.doc.toString()).toBe(real);
  });

  it('offers to write a file deleted on disk again', async () => {
    const { container, state, last } = await open();
    state.gone = true;
    act(() => { assetChanged(PATH, -5); });
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('gone from disk'); });
    expect(screen.queryByRole('button', { name: 'Load from disk' })).toBeNull();
    drag(node(container, 'plan'), [600, 150], [643, 150]);
    await userEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    await waitFor(() => { expect(last().layout.nodes.plan.x).toBe(600); });
  });

  it('keeps edits a failed save left, asking when the disk then changes', async () => {
    const { container, writeFile, elsewhere } = await open();
    writeFile.mockRejectedValueOnce(new Error('network down'));
    drag(node(container, 'plan'), [600, 150], [643, 150]);
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('Could not save'); });
    const changed = JSON.parse(real) as Doc;
    changed.nodes[0].label = 'Changed by an agent';
    elsewhere(JSON.stringify(changed));
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('Changed on disk'); });
    expect(node(container, 'logic').textContent).not.toContain('Changed by an agent');
  });

  it('applies a drag to a change on disk that loaded while it lasted', async () => {
    const { container, elsewhere, last } = await open();
    fireEvent.pointerDown(node(container, 'plan'), { button: 0, clientX: 600, clientY: 150 });
    fireEvent.pointerMove(window, { clientX: 643, clientY: 150 });
    const changed = JSON.parse(real) as Doc;
    changed.nodes[0].label = 'Changed by an agent';
    elsewhere(JSON.stringify(changed));
    await waitFor(() => { expect(node(container, 'logic').textContent).toContain('Changed by an agent'); });
    fireEvent.pointerUp(window, { clientX: 643, clientY: 150 });
    await waitFor(() => { expect(last().layout.nodes.plan.x).toBe(600); });
    expect(last().nodes[0].label).toBe('Changed by an agent');
  });

  it('leaves the Enter that ends an IME composition to the IME', async () => {
    const { container, writeFile } = await open();
    click(node(container, 'plan'));
    const label = screen.getByRole('textbox', { name: 'Label' });
    await userEvent.clear(label);
    await userEvent.type(label, 'Ti');
    fireEvent.keyDown(label, { key: 'Enter', isComposing: true, keyCode: 229 });
    fireEvent.keyDown(label, { key: 'Escape', keyCode: 229 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(writeFile).not.toHaveBeenCalled();
    expect((label as HTMLInputElement).value).toBe('Ti');
  });

  it('holds no lock for a file that does not parse until it is edited', async () => {
    const fake = disk('{ "version": 1,');
    const onWaiting = vi.fn();
    render(<DiagramPage files={fake.files} path={PATH} readOnly={false} usages={[]} onOpenUsage={vi.fn()} onWaiting={onWaiting} />);
    await brokenFileOpened();
    expect(onWaiting).not.toHaveBeenCalledWith(true);
    act(() => { jsonView().dispatch({ changes: { from: 0, insert: ' ' } }); });
    expect(onWaiting).toHaveBeenLastCalledWith(true);
  });

  it('shows edits left in a conflict again on the next open', async () => {
    const fake = disk();
    const page = () => <DiagramPage files={fake.files} path={PATH} readOnly={false} usages={[]} onOpenUsage={vi.fn()} />;
    const first = render(page());
    await waitFor(() => { expect(first.container.querySelector('svg.dg-svg')).not.toBeNull(); });
    fake.state.mtimeMs = 99;
    drag(node(first.container, 'plan'), [600, 150], [643, 150]);
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('changed on disk'); });
    first.unmount();
    const second = render(page());
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('changed on disk'); });
    await userEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    await waitFor(() => { expect(fake.last().layout.nodes.plan.x).toBe(600); });
    second.unmount();
    // Saved: nothing is kept for a third open.
    render(page());
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('Saved'); });
  });

  it('holds the lock and asks before a reload while left edits wait, after the page is gone', async () => {
    const fake = disk();
    function Probe() {
      return <span data-testid="left">{useLeftEdits(fake.files) ?? "none"}</span>;
    }
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    render(<Probe />);
    const page = () => <DiagramPage files={fake.files} path={PATH} readOnly={false} usages={[]} onOpenUsage={vi.fn()} />;
    const first = render(page());
    await waitFor(() => { expect(first.container.querySelector('svg.dg-svg')).not.toBeNull(); });
    expect(unload()).toBe(false);
    fake.state.mtimeMs = 99;
    drag(node(first.container, 'plan'), [600, 150], [643, 150]);
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('changed on disk'); });
    expect(unload()).toBe(true);
    first.unmount();
    expect(screen.getByTestId('left').textContent).toBe(PATH);
    expect(unload()).toBe(true);
    render(page());
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('changed on disk'); });
    await userEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('Saved'); });
    expect(screen.getByTestId('left').textContent).toBe('none');
    expect(unload()).toBe(false);
  });

  it('tells the App while edits are not on disk yet', async () => {
    const fake = disk();
    const onWaiting = vi.fn();
    const { container } = render(<DiagramPage files={fake.files} path={PATH} readOnly={false} usages={[]} onOpenUsage={vi.fn()} onWaiting={onWaiting} />);
    await waitFor(() => { expect(container.querySelector('svg.dg-svg')).not.toBeNull(); });
    drag(node(container, 'plan'), [600, 150], [643, 150]);
    expect(onWaiting).toHaveBeenLastCalledWith(true);
    await waitFor(() => { expect(onWaiting).toHaveBeenLastCalledWith(false); });
  });

  it('says why a diagram does not draw', async () => {
    const broken = JSON.parse(real) as Doc;
    broken.edges[0].to = 'ghost';
    const fake = disk(JSON.stringify(broken));
    render(<DiagramPage files={fake.files} path={PATH} readOnly={false} usages={[]} onOpenUsage={vi.fn()} />);
    await waitFor(() => { expect(screen.getByText(/"ghost"/, { selector: '.studio-dg-problem' })).toBeTruthy(); });
    expect(screen.getByText(/No note draws it yet/)).toBeTruthy();
  });
});
