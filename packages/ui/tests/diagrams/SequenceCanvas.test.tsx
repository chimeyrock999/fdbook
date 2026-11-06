// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { createFilesClient } from '#api/files.ts';
import { DiagramPage } from '#diagrams/DiagramPage.tsx';
import { setWaypoints } from '#diagrams/edits.ts';
import { buildScene } from '@fdbook/diagram/scene.ts';
import { parseDiagram, type DiagramInput } from '@fdbook/diagram/schema.ts';
import { stubLayout } from '#tests/support/visual-editor.tsx';
import { readDoc } from '#tests/support/docs.ts';

const PATH = 'diagrams/examples/coroutine-yield.diagram.json';
// An example diagram of FdBook's docs.
const real = readDoc(PATH);
const drawn = buildScene(parseDiagram(JSON.parse(real))).sequence;
if (!drawn) throw new Error('not a sequence');
const layer = drawn;
const yOf = (id: string) => layer.messages.find((message) => message.edge.id === id)?.y ?? NaN;

beforeAll(stubLayout);

afterEach(() => {
  cleanup();
});

function disk() {
  const state = { content: real, mtimeMs: 1 };
  const writes: string[] = [];
  const writeFile = vi.fn((_path: string, text: string) => {
    state.content = text;
    state.mtimeMs += 1;
    writes.push(text);
    return Promise.resolve(state.mtimeMs);
  });
  const readFile = vi.fn(() => Promise.resolve({ path: PATH, content: state.content, mtimeMs: state.mtimeMs }));
  const files = { readFile, writeFile } as unknown as ReturnType<typeof createFilesClient>;
  const last = () => JSON.parse(writes.at(-1) ?? 'null') as DiagramInput;
  return { files, writeFile, last };
}

async function open(readOnly = false) {
  const fake = disk();
  const { container } = render(<DiagramPage files={fake.files} path={PATH} readOnly={readOnly} usages={[]} onOpenUsage={vi.fn()} />);
  await waitFor(() => { expect(container.querySelector('svg.dg-svg')).not.toBeNull(); });
  return { ...fake, container };
}

function one(container: ParentNode, selector: string): Element {
  const found = container.querySelector(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
}

// A press, a move and a release, in SVG units (jsdom lays nothing out, so
// the canvas maps client pixels one to one).
function drag(target: Element, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(target, { button: 0, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(window, { clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(window, { clientX: to[0], clientY: to[1] });
}
const ids = (items: { id: string }[] | undefined) => (items ?? []).map((item) => item.id);

describe('the sequence editor', () => {
  it('draws lifelines, a grip per message and a handle under each lifeline, and offers no frames', async () => {
    const { container } = await open();
    expect(container.querySelectorAll('.dg-svg [data-lifeline]')).toHaveLength(4);
    expect(container.querySelectorAll('.studio-dg-overlay [data-grip]')).toHaveLength(6);
    expect(container.querySelectorAll('.studio-dg-overlay [data-lifeline-port]')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Add a frame' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a participant' })).toBeTruthy();
  });

  it('drags a participant to another column', async () => {
    const { container, last, writeFile } = await open();
    const io = one(container, '.dg-svg [data-node-id="io"]');
    drag(io, [layer.columns.io, 100], [10, 100]);
    await waitFor(() => { expect(writeFile).toHaveBeenCalled(); });
    expect(ids(last().nodes)).toEqual(['io', 'a', 'runtime', 'b']);
  });

  it('drags a message by its grip to another place in the timeline', async () => {
    const { container, last, writeFile } = await open();
    drag(one(container, '[data-grip="pause"]'), [12, yOf('pause')], [12, yOf('done') + 10]);
    await waitFor(() => { expect(writeFile).toHaveBeenCalled(); });
    expect(ids(last().edges)).toEqual(['run-a', 'query', 'run-b', 'done', 'pause', 'resume']);
    // "pause" opened the segment and leaves it; the segment keeps the rest.
    expect(last().segments).toEqual([{ label: 'A waits', from: 'run-b', to: 'done' }]);
  });

  it('adds a message from one lifeline to another where it is dropped, and selects it', async () => {
    const { container, last, writeFile } = await open();
    const port = one(container, '[data-lifeline-port="b"]');
    drag(port, [layer.columns.b, 400], [layer.columns.io, yOf('run-b') + 10]);
    await waitFor(() => { expect(writeFile).toHaveBeenCalled(); });
    const edges = ids(last().edges);
    expect(edges[edges.indexOf('run-b') + 1]).toBe('b-io');
    expect(last().edges?.find((edge) => edge.id === 'b-io')).toEqual({ id: 'b-io', from: 'b', to: 'io', label: 'message' });
    expect(screen.getByRole('heading', { name: 'Message b → io' })).toBeTruthy();
  });

  it('moves a selected message with the panel and the arrow keys, and refuses an end that would meet the other', async () => {
    const { container, last, writeFile } = await open();
    fireEvent.pointerDown(one(container, '[data-hit-edge="query"]'), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 0, clientY: 0 });
    expect(screen.getByRole('heading', { name: 'Message 2 of 6' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Later/ }));
    await waitFor(() => { expect(ids(last().edges)[2]).toBe('query'); });
    fireEvent.keyDown(one(container, '.studio-dg-canvas'), { key: 'ArrowUp' });
    await waitFor(() => { expect(ids(last().edges)[1]).toBe('query'); });
    const calls = writeFile.mock.calls.length;
    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'a' } });
    expect(writeFile.mock.calls.length).toBe(calls);
  });

  it('removes a message and keeps the segment around it', async () => {
    const { container, last } = await open();
    fireEvent.pointerDown(one(container, '[data-hit-edge="pause"]'), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 0, clientY: 0 });
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(ids(last().edges)).not.toContain('pause'); });
    expect(last().segments).toEqual([{ label: 'A waits', from: 'run-b', to: 'done' }]);
  });

  it('edits the segments and activations from the diagram panel', async () => {
    const { last } = await open();
    expect(screen.getByRole('group', { name: 'Segment A waits' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove the segment A waits' }));
    await waitFor(() => { expect(last().segments).toBeUndefined(); });
    await userEvent.click(screen.getByRole('button', { name: /Add a segment/ }));
    await waitFor(() => { expect(last().segments).toEqual([{ label: 'Phase', from: 'resume', to: 'resume' }]); });
  });

  it('leaves the file alone when a participant is dropped back in its own column', async () => {
    const { container, writeFile } = await open();
    drag(one(container, '.dg-svg [data-node-id="b"]'), [layer.columns.b, 100], [layer.columns.b + 20, 100]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(writeFile).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('Saved');
  });

  it.each([
    ['below its last message', (box: { y: number; height: number }) => box.y + box.height - 4, 'done', { from: 'pause', to: 'b-io' }],
    ['above its first message', (box: { y: number }) => box.y + 4, 'query', { from: 'b-io', to: 'done' }],
  ] as const)('adds a message dropped inside a segment %s to that segment', async (_where, at, before, range) => {
    const { container, last, writeFile } = await open();
    drag(one(container, '[data-lifeline-port="b"]'), [layer.columns.b, 400], [layer.columns.io, at(layer.segments[0].frame)]);
    await waitFor(() => { expect(writeFile).toHaveBeenCalled(); });
    expect(ids(last().edges).indexOf('b-io')).toBe(ids(last().edges).indexOf(before) + 1);
    expect(last().segments).toEqual([{ label: 'A waits', ...range }]);
  });

  it('copies no participant: ⌘D does nothing, and an edit that needs a layout is refused', async () => {
    const { container, writeFile } = await open();
    fireEvent.pointerDown(one(container, '.dg-svg [data-node-id="b"]'), { button: 0, clientX: layer.columns.b, clientY: 100 });
    fireEvent.pointerUp(window, { clientX: layer.columns.b, clientY: 100 });
    fireEvent.keyDown(one(container, '.studio-dg-canvas'), { key: 'd', metaKey: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(writeFile).not.toHaveBeenCalled();
    expect(() => setWaypoints(JSON.parse(real) as DiagramInput, 'pause', [[0, 0]])).toThrow(/sequence lays itself out/);
  });

  it('shows the drawing without handles when read only', async () => {
    const { container } = await open(true);
    expect(container.querySelectorAll('.studio-dg-overlay [data-grip]')).toHaveLength(0);
    expect(container.querySelectorAll('.studio-dg-overlay [data-lifeline-port]')).toHaveLength(0);
  });
});
