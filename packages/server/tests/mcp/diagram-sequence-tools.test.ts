import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diagramTools } from '#mcp/diagram-tools.ts';
import type { StudioToolContext, ToolResult } from '#mcp/tool.ts';
import type { DiagramInput } from '@fdbook/diagram/schema.ts';
import { toolContext } from '#tests/support/studio-files.ts';
import { makeWorktree, type Worktree } from '@fdbook/testing/studio.ts';

const SRC = 'demo/call';
const PATH = 'diagrams/demo/call.diagram.json';
let worktree: Worktree;
let ctx: StudioToolContext;

const call = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
  const found = diagramTools.find((each) => each.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found.run(found.input.parse(args), ctx);
};
const text = (result: ToolResult) => result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
const onDisk = async () => JSON.parse(await readFile(join(worktree.root, PATH), 'utf8')) as DiagramInput;
const ids = (items: { id: string }[] | undefined) => (items ?? []).map((item) => item.id);
const issues = (result: ToolResult) => (result.structured?.issues ?? []) as { code: string }[];

const SEQUENCE = {
  type: 'sequence',
  title: 'A call',
  kinds: [{ id: 'part', label: 'Part', tone: 'blue' }],
  nodes: [{ id: 'client', kind: 'part', label: 'Client' }, { id: 'api', kind: 'part', label: 'API' }, { id: 'db', kind: 'part', label: 'Database' }],
  edges: [
    { id: 'get', from: 'client', to: 'api', label: 'GET /items' },
    { id: 'ok', from: 'api', to: 'client', label: '200', variant: 'return' },
  ],
};

beforeEach(async () => {
  worktree = await makeWorktree();
  ctx = toolContext(worktree.root);
  await call('diagram_create', { src: SRC, content: SEQUENCE });
});

afterEach(async () => {
  await worktree.remove();
});

describe('diagram tools on a sequence', () => {
  it('creates a sequence without a layout and checks it clean', async () => {
    const created = await onDisk();
    expect(created).toMatchObject({ $schema: '../diagram.schema.json', version: 1, type: 'sequence' });
    expect(created.layout).toBeUndefined();
    expect(issues(await call('diagram_validate', { src: SRC }))).toEqual([]);
  });

  it('puts a new message where it is asked to in the timeline, and reorders participants and messages', async () => {
    const added = await call('diagram_connect', { src: SRC, id: 'query', from: 'api', to: 'db', label: 'select', detail: 'reads the items', after: 'get' });
    expect(issues(added)).toEqual([]);
    expect(ids((await onDisk()).edges)).toEqual(['get', 'query', 'ok']);

    await call('diagram_reorder', { src: SRC, node: 'db', index: 0 });
    await call('diagram_reorder', { src: SRC, edge: 'ok', index: 1 });
    const after = await onDisk();
    expect(ids(after.nodes)).toEqual(['db', 'client', 'api']);
    expect(ids(after.edges)).toEqual(['get', 'ok', 'query']);

    const both = await call('diagram_reorder', { src: SRC, node: 'db', edge: 'ok', index: 0 });
    expect(both.isError).toBe(true);
  });

  it('sets the segments and activations, and a removed message moves their ends', async () => {
    await call('diagram_connect', { src: SRC, id: 'query', from: 'api', to: 'db', label: 'select', after: 'get' });
    await call('diagram_update', { src: SRC, segments: [{ label: 'Round trip', from: 'get', to: 'ok' }] });
    await call('diagram_update', { src: SRC, activations: [{ node: 'api', from: 'get', to: 'ok' }] });
    expect((await onDisk()).segments).toEqual([{ label: 'Round trip', from: 'get', to: 'ok' }]);
    const removed = await call('diagram_remove_edge', { src: SRC, id: 'get' });
    expect(issues(removed)).toEqual([]);
    const after = await onDisk();
    expect(after.segments).toEqual([{ label: 'Round trip', from: 'query', to: 'ok' }]);
    expect(after.activations).toEqual([{ node: 'api', from: 'query', to: 'ok' }]);
    await call('diagram_update', { src: SRC, segments: [] });
    expect((await onDisk()).segments).toBeUndefined();
  });

  it('refuses positions on a sequence and says why, and has nothing to lay out', async () => {
    const moved = await call('diagram_move', { src: SRC, id: 'api', dx: 20 });
    expect(moved.isError).toBe(true);
    expect(text(moved)).toContain('op/sequence-has-no-layout');
    const laid = await call('diagram_layout', { src: SRC });
    expect(text(laid)).toContain('nothing to place');
    const self = await call('diagram_connect', { src: SRC, from: 'api', to: 'api', label: 'think' });
    expect(issues(self).map((issue) => issue.code)).toContain('sequence/self-message');
  });

  it('refuses segments on an architecture', async () => {
    const created = await call('diagram_create', { src: 'demo/arch', content: { title: 'A', kinds: [{ id: 'k', label: 'K', tone: 'blue' }], nodes: [{ id: 'a', kind: 'k', label: 'A' }] } });
    expect(created.isError).toBeUndefined();
    const result = await call('diagram_update', { src: 'demo/arch', segments: [{ label: 'S', from: 'x', to: 'x' }] });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('only a sequence');
  });
});
