// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { createFilesClient } from '../../../src/api/files';
import { DiagramPage } from '../../../src/diagrams/DiagramPage';
import { buildScene } from '@site/lib/diagram/scene';
import { parseDiagram, type DiagramInput } from '@site/lib/diagram/schema';
import { stubLayout } from '../../support/visual-editor';

const PATH = 'diagrams/examples/instance-pool.diagram.json';
// The repository root, from tools/notes-studio/tests/src/diagrams.
const real = readFileSync(join(import.meta.dirname, '../../../../..', PATH), 'utf8');
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
