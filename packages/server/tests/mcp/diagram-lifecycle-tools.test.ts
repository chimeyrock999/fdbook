import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diagramTools } from '#mcp/diagram-tools.ts';
import type { StudioToolContext, ToolResult } from '#mcp/tool.ts';
import type { DiagramInput } from '@fdbook/diagram/schema.ts';
import { toolContext } from '#tests/support/studio-files.ts';
import { makeWorktree, type Worktree } from '@fdbook/testing/studio.ts';

const SRC = 'demo/order';
const PATH = 'diagrams/demo/order.diagram.json';
let worktree: Worktree;
let ctx: StudioToolContext;

const call = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
  const found = diagramTools.find((each) => each.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found.run(found.input.parse(args), ctx);
};
const text = (result: ToolResult) => result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
const onDisk = async () => JSON.parse(await readFile(join(worktree.root, PATH), 'utf8')) as DiagramInput;
const issues = (result: ToolResult) => (result.structured?.issues ?? []) as { code: string }[];

const LIFECYCLE = {
  type: 'lifecycle',
  title: 'An order',
  kinds: [{ id: 'step', label: 'Step', tone: 'blue' }, { id: 'end', label: 'End', tone: 'green', icon: 'check' }],
  mainPath: ['placed', 'paid', 'shipped'],
  nodes: [{ id: 'placed', kind: 'step', label: 'Placed' }, { id: 'paid', kind: 'step', label: 'Paid' }, { id: 'shipped', kind: 'end', label: 'Shipped' }],
  edges: [{ id: 'pay', from: 'placed', to: 'paid', label: 'pay' }, { id: 'ship', from: 'paid', to: 'shipped', label: 'ship' }],
};

beforeEach(async () => {
  worktree = await makeWorktree();
  ctx = toolContext(worktree.root);
  await call('diagram_create', { src: SRC, content: LIFECYCLE });
});

afterEach(async () => {
  await worktree.remove();
});

describe('diagram tools on a lifecycle', () => {
  it('creates a lifecycle without a layout and checks it clean', async () => {
    const created = await onDisk();
    expect(created).toMatchObject({ type: 'lifecycle', mainPath: ['placed', 'paid', 'shipped'] });
    expect(created.layout).toBeUndefined();
    expect(issues(await call('diagram_validate', { src: SRC }))).toEqual([]);
  });

  it('adds a state and its transitions, and sets the main path', async () => {
    const added = await call('diagram_add_node', { src: SRC, id: 'cancelled', kind: 'end', label: 'Cancelled', edges: [{ from: 'placed', label: 'cancel', variant: 'alert' }] });
    expect(issues(added)).toEqual([]);
    expect((await onDisk()).layout).toBeUndefined();
    const gap = await call('diagram_update', { src: SRC, mainPath: ['placed', 'shipped'] });
    expect(issues(gap).map((issue) => issue.code)).toEqual(['lifecycle/main-path-gap']);
    await call('diagram_update', { src: SRC, mainPath: ['placed', 'paid', 'shipped'] });
    expect((await onDisk()).mainPath).toEqual(['placed', 'paid', 'shipped']);
  });

  it('refuses positions and reordering, says there is nothing to lay out, and refuses a main path elsewhere', async () => {
    const moved = await call('diagram_move', { src: SRC, id: 'paid', dx: 20 });
    expect(moved.isError).toBe(true);
    expect(text(moved)).toContain('op/lifecycle-has-no-layout');
    expect((await call('diagram_reorder', { src: SRC, node: 'paid', index: 0 })).isError).toBe(true);
    expect(text(await call('diagram_layout', { src: SRC }))).toContain('nothing to place');
    await call('diagram_create', { src: 'demo/arch', content: { title: 'A', kinds: [{ id: 'k', label: 'K', tone: 'blue' }], nodes: [{ id: 'a', kind: 'k', label: 'A' }] } });
    const wrong = await call('diagram_update', { src: 'demo/arch', mainPath: ['a'] });
    expect(wrong.isError).toBe(true);
    expect(text(wrong)).toContain('only a lifecycle');
  });

  it('removes a state from the main path with it', async () => {
    await call('diagram_remove_node', { src: SRC, id: 'paid' });
    expect((await onDisk()).mainPath).toEqual(['placed', 'shipped']);
  });
});
