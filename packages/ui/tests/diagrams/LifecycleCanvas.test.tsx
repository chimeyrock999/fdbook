// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { createFilesClient } from '#api/files.ts';
import { DiagramPage } from '#diagrams/DiagramPage.tsx';
import { buildScene } from '@fdbook/diagram/scene.ts';
import { parseDiagram, type DiagramInput } from '@fdbook/diagram/schema.ts';
import { stubLayout } from '#tests/support/visual-editor.tsx';
import { readDoc } from '#tests/support/docs.ts';

const PATH = 'diagrams/examples/instance-pool.diagram.json';
// An example diagram of FdBook's docs.
const real = readDoc(PATH);
const scene = buildScene(parseDiagram(JSON.parse(real)));
const centre = (id: string): [number, number] => {
  const node = scene.nodes.find((each) => each.id === id);
  if (!node) throw new Error(`no state ${id}`);
  return [node.cx, node.cy];
};
const handle = (id: string): [number, number] => {
  const node = scene.nodes.find((each) => each.id === id);
  if (!node) throw new Error(`no state ${id}`);
  return [node.x + node.width, node.cy];
};

beforeAll(stubLayout);

afterEach(() => {
  cleanup();
});

function disk(content = real) {
  const state = { content, mtimeMs: 1 };
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

async function open(readOnly = false, content = real) {
  const fake = disk(content);
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
const click = (target: Element) => { drag(target, [0, 0], [0, 0]); };

describe('the lifecycle editor', () => {
  it('draws the states with a handle each, and offers states but no frames or copies', async () => {
    const { container } = await open();
    expect(container.querySelectorAll('.dg-svg [data-node-id]')).toHaveLength(6);
    expect(container.querySelectorAll('.studio-dg-overlay [data-state-port]')).toHaveLength(6);
    expect(container.querySelector('.dg-svg [data-initial-marker]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a frame' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a state' })).toBeTruthy();
  });

  it('adds a transition dragged from one state\'s handle to another, or back onto itself, and selects it', async () => {
    const { container, last, writeFile } = await open();
    drag(one(container, '[data-state-port="idle"]'), handle('idle'), centre('failed'));
    await waitFor(() => { expect(writeFile).toHaveBeenCalledTimes(1); });
    expect(last().edges?.at(-1)).toEqual({ id: 'idle-failed', from: 'idle', to: 'failed', label: 'event' });
    expect(screen.getByRole('heading', { name: 'Transition idle → failed' })).toBeTruthy();
    drag(one(container, '[data-state-port="idle"]'), handle('idle'), centre('idle'));
    await waitFor(() => { expect(writeFile).toHaveBeenCalledTimes(2); });
    expect(last().edges?.at(-1)).toMatchObject({ id: 'idle-idle', from: 'idle', to: 'idle' });
  });

  it('adds nothing for a press and release on a handle without a drag', async () => {
    const { container, writeFile } = await open();
    drag(one(container, '[data-state-port="idle"]'), handle('idle'), handle('idle'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('keeps drawing, with its handles, while the main path is broken, so it can be fixed here', async () => {
    const { container, last } = await open();
    await userEvent.click(screen.getByRole('button', { name: 'Take READY off the main path' }));
    await userEvent.click(screen.getByRole('button', { name: 'Take PLACED off the main path' }));
    await userEvent.click(screen.getByRole('button', { name: 'Take TERMINATED off the main path' }));
    await waitFor(() => { expect(last().mainPath).toEqual(['launching']); });
    expect(container.querySelector('svg.dg-svg')).not.toBeNull();
    expect(container.querySelectorAll('.studio-dg-overlay [data-state-port]')).toHaveLength(6);
  });

  it('lists the exits drawn with a transition (a bus here), and selects one from there', async () => {
    const { container } = await open();
    click(one(container, '[data-hit-edge="launch-lost"]'));
    await userEvent.click(screen.getByRole('button', { name: 'placed → failed' }));
    expect(screen.getByRole('heading', { name: 'Transition placed → failed' })).toBeTruthy();
    // One hit per drawn route: a bus gives each exit its own tick, a frame
    // exit is one route for all.
    expect(container.querySelectorAll('.studio-dg-overlay [data-hit-edge]')).toHaveLength(new Set(scene.edges.map((edge) => edge.d)).size);
  });

  it('gives an exit several framed phases share one hit on the canvas', async () => {
    // Building and Verifying both abort into Aborted: one route from their frame.
    const release = readDoc('diagrams/examples/deployment-release.diagram.json');
    const { container } = await open(false, release);
    const hits = [...container.querySelectorAll<SVGElement>('.studio-dg-overlay [data-hit-edge]')].map((hit) => hit.dataset.hitEdge);
    expect(hits).toContain('building-aborted');
    expect(hits).not.toContain('verifying-aborted');
  });

  it('lists only the exits the layout drew as one, from its frame, not any with the same label', async () => {
    // a and b leave for f as one exit from their frame; x → f says the same
    // but is drawn on its own.
    const doc = {
      version: 1, type: 'lifecycle', title: 'T', kinds: [{ id: 'k', label: 'K', tone: 'blue' }], mainPath: ['a', 'b', 'c'],
      nodes: ['a', 'b', 'c', 'f', 'x'].map((id) => ({ id, kind: 'k', label: id.toUpperCase() })),
      edges: [
        { id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' },
        { id: 'af', from: 'a', to: 'f', label: 'err' }, { id: 'bf', from: 'b', to: 'f', label: 'err' },
        { id: 'cx', from: 'c', to: 'x' }, { id: 'xf', from: 'x', to: 'f', label: 'err' },
      ],
    };
    const { container } = await open(false, JSON.stringify(doc));
    click(one(container, '[data-hit-edge="xf"]'));
    expect(screen.queryByText('Drawn as one exit with:')).toBeNull();
    click(one(container, '[data-hit-edge="af"]'));
    expect(screen.getByRole('button', { name: 'b → f' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'x → f' })).toBeNull();
  });

  it('tells a state where it sits: initial, a main-path step, final', async () => {
    const { container } = await open();
    click(one(container, '.dg-svg [data-node-id="launching"]'));
    expect(screen.getByText(/The initial state/)).toBeTruthy();
    click(one(container, '.dg-svg [data-node-id="terminated"]'));
    expect(screen.getByText(/Step 4 of the main path\. No transition out: a final state/)).toBeTruthy();
  });

  it('edits the main path, naming a step left without a transition', async () => {
    const { last, writeFile } = await open();
    await userEvent.click(screen.getByRole('button', { name: 'Take READY off the main path' }));
    await waitFor(() => { expect(writeFile).toHaveBeenCalled(); });
    expect(last().mainPath).toEqual(['launching', 'placed', 'terminated']);
    expect(screen.getByRole('alert').textContent).toContain('No transition into PLACED');
    await userEvent.click(screen.getByRole('button', { name: 'Move PLACED earlier' }));
    await waitFor(() => { expect(last().mainPath).toEqual(['placed', 'launching', 'terminated']); });
  });

  it('shows the drawing without handles when read only', async () => {
    const { container } = await open(true);
    expect(container.querySelectorAll('.studio-dg-overlay [data-state-port]')).toHaveLength(0);
  });
});
