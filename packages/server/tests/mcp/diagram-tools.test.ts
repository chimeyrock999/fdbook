import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diagramTools } from '#mcp/diagram-tools.ts';
import type { StudioToolContext, ToolResult } from '#mcp/tool.ts';
import type { DiagramInput } from '@fdbook/diagram/schema.ts';
import { toolContext } from '#tests/support/studio-files.ts';
import { DEMO_DIAGRAM, makeWorktree, type Worktree } from '@fdbook/testing/studio.ts';

const SRC = 'demo/flow';
let worktree: Worktree;
let ctx: StudioToolContext;

const call = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
  const found = diagramTools.find((each) => each.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found.run(found.input.parse(args), ctx);
};
const text = (result: ToolResult) => result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
const onDisk = async (path = DEMO_DIAGRAM) => JSON.parse(await readFile(join(worktree.root, path), 'utf8')) as DiagramInput & { $schema: string; edges: NonNullable<DiagramInput['edges']>; layout: { edges: Record<string, unknown> } };
const nodeOf = (diagram: DiagramInput, id: string) => diagram.nodes.find((node) => node.id === id);
const issues = (result: ToolResult) => (result.structured?.issues ?? []) as { code: string; severity: string }[];
const errors = (result: ToolResult) => issues(result).filter((issue) => issue.severity === 'error');

beforeEach(async () => {
  worktree = await makeWorktree();
  ctx = toolContext(worktree.root);
});

afterEach(async () => {
  await worktree.remove();
});

describe('diagram tools', () => {
  it('names every tool diagram_* and marks the ones that write', () => {
    expect(diagramTools.map((each) => [each.name, each.access])).toEqual([
      ['diagram_list', 'read'],
      ['diagram_read', 'read'],
      ['diagram_validate', 'read'],
      ['diagram_render_png', 'read'],
      ['diagram_create', 'write'],
      ['diagram_add_node', 'write'],
      ['diagram_move', 'write'],
      ['diagram_connect', 'write'],
      ['diagram_set_note', 'write'],
      ['diagram_update', 'write'],
      ['diagram_reorder', 'write'],
      ['diagram_remove_edge', 'write'],
      ['diagram_remove_node', 'write'],
      ['diagram_layout', 'write'],
    ]);
  });

  it('lists the diagrams by src', async () => {
    expect((await call('diagram_list', {})).structured).toEqual({ diagrams: [SRC] });
  });

  it('adds a node with its edge next to what it connects to, moving no other node', async () => {
    const before = await onDisk();
    const result = await call('diagram_add_node', {
      src: SRC, id: 'catalyst', kind: 'backend', label: 'Catalyst', sublabel: 'rule-based optimizer',
      edges: [{ from: 'plan', label: 'rewrite' }],
    });
    expect(result.isError).toBeUndefined();
    expect(errors(result)).toEqual([]);
    const after = await onDisk();
    for (const [id, box] of Object.entries(before.layout.nodes)) expect(after.layout.nodes[id]).toEqual(box);
    expect(after.layout.nodes.catalyst.h).toBe(68);
    expect(after.edges.at(-1)).toEqual({ id: 'plan-catalyst', from: 'plan', to: 'catalyst', label: 'rewrite' });
    expect(result.structured).toMatchObject({ path: DEMO_DIAGRAM, placed: ['catalyst'] });
  });

  it('saves only the lines an edit touched', async () => {
    const before = (await readFile(join(worktree.root, DEMO_DIAGRAM), 'utf8')).split('\n');
    await call('diagram_move', { src: SRC, id: 'logic', dy: 20 });
    const after = (await readFile(join(worktree.root, DEMO_DIAGRAM), 'utf8')).split('\n');
    const changed = after.filter((line, index) => line !== before[index]);
    expect(changed).toEqual(['      "logic": { "x": 40, "y": 140, "w": 190, "h": 68 },']);
  });

  it('sets and removes a note, and removes a node with its edges and layout', async () => {
    await call('diagram_set_note', { src: SRC, id: 'plan', note: { role: 'The **logical** plan.', points: ['Built lazily.'] } });
    expect(nodeOf(await onDisk(), 'plan')?.note).toEqual({ role: 'The **logical** plan.', points: ['Built lazily.'] });
    await call('diagram_set_note', { src: SRC, id: 'plan', note: null });
    expect(nodeOf(await onDisk(), 'plan')?.note).toBeUndefined();

    const result = await call('diagram_remove_node', { src: SRC, id: 'executors' });
    const after = await onDisk();
    expect(after.nodes.map((node) => node.id)).not.toContain('executors');
    expect(after.edges.map((edge) => edge.id)).not.toContain('schedule');
    expect(after.layout.nodes.executors).toBeUndefined();
    expect(after.layout.edges.schedule).toBeUndefined();
    expect(errors(result)).toEqual([]);
  });

  it('updates a node, pins an edge label, changes a group and removes an edge', async () => {
    await call('diagram_update', { src: SRC, node: { id: 'plan', label: 'Plan', sublabel: null } });
    await call('diagram_update', { src: SRC, edge: { id: 'build', labelDy: 20, variant: 'dashed' } });
    await call('diagram_update', { src: SRC, group: { id: 'application-runtime-boundary', label: 'Application' } });
    const removed = await call('diagram_remove_edge', { src: SRC, id: 'schedule' });
    expect(errors(removed)).toEqual([]);
    const after = await onDisk();
    expect(nodeOf(after, 'plan')).toEqual({ id: 'plan', kind: 'backend', label: 'Plan' });
    expect(after.edges.find((edge) => edge.id === 'build')).toMatchObject({ variant: 'dashed' });
    expect(after.layout.edges.build).toEqual({ labelDy: 20 });
    expect(after.groups?.[0].label).toBe('Application');
    expect(after.edges.map((edge) => edge.id)).not.toContain('schedule');
    expect(after.layout.edges.schedule).toBeUndefined();

    const both = await call('diagram_update', { src: SRC, node: { id: 'plan', label: 'X' }, edge: { id: 'build', label: 'Y' } });
    expect(both.isError).toBe(true);
    expect(text(both)).toContain('exactly one');
  });

  it('answers an unknown id as an error result the agent can act on', async () => {
    const result = await call('diagram_connect', { src: SRC, from: 'plan', to: 'ghost' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('op/unknown-endpoint');
  });

  it('refuses to save over a change made since the read', async () => {
    const real = ctx.files;
    ctx = {
      ...ctx,
      files: {
        ...real,
        read: async (path) => {
          const read = await real.read(path);
          // Someone saves right after the tool read the file.
          await writeFile(join(worktree.root, path), `${read?.content ?? ''}\n`);
          return read;
        },
      },
    };
    const result = await call('diagram_move', { src: SRC, id: 'logic', dx: 10 });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('changed since it was read');
  });

  it('answers a diagram it cannot lay out, or a malformed one, with what to fix', async () => {
    const created = await call('diagram_create', { src: 'demo/broken', content: { title: 'Broken', kinds: [{ id: 'k', label: 'K', tone: 'blue' }], nodes: [{ id: 'a', kind: 'k', label: 'A' }], layout: { canvas: [800, 600] } } });
    expect(created.isError).toBe(true);
    expect(text(created)).toContain('schema/invalid at layout.nodes');

    const diagram = await onDisk();
    diagram.groups = [{ id: 'g', label: 'G', members: ['h'] }, { id: 'h', label: 'H', members: ['g', 'logic'] }];
    await writeFile(join(worktree.root, DEMO_DIAGRAM), JSON.stringify(diagram));
    const added = await call('diagram_add_node', { src: SRC, id: 'extra', kind: 'backend', label: 'Extra' });
    expect(added.isError).toBe(true);
    expect(text(added)).toContain('op/invalid-diagram');
    expect(text(added)).toContain('structure/group-cycle');
    // An edit that places nothing still saves, so the cycle can be undone.
    expect((await call('diagram_move', { src: SRC, id: 'logic', dx: 10 })).isError).toBeUndefined();
  });

  it('refuses a src outside diagrams/', async () => {
    for (const src of ['../content/docs/index', '../../package']) {
      const result = await call('diagram_read', { src });
      expect(result.isError).toBe(true);
    }
  });

  it('creates a diagram from its content alone, laid out, with the schema link', async () => {
    const result = await call('diagram_create', {
      src: 'demo/new/pipeline',
      content: {
        title: 'A pipeline',
        kinds: [{ id: 'step', label: 'Step', tone: 'blue', icon: 'code' }],
        nodes: [{ id: 'read', kind: 'step', label: 'Read' }, { id: 'clean', kind: 'step', label: 'Clean' }, { id: 'write', kind: 'step', label: 'Write' }],
        edges: [{ id: 'a', from: 'read', to: 'clean', label: 'rows' }, { id: 'b', from: 'clean', to: 'write' }],
      },
    });
    expect(errors(result)).toEqual([]);
    const created = await onDisk('diagrams/demo/new/pipeline.diagram.json');
    expect(created.$schema).toBe('../../diagram.schema.json');
    expect(Object.keys(created.layout.nodes)).toEqual(['read', 'clean', 'write']);
    // An existing file is not overwritten.
    const again = await call('diagram_create', { src: 'demo/new/pipeline', content: { title: 'x', kinds: [], nodes: [] } });
    expect(again.isError).toBe(true);
    expect(text(again)).toContain('already exists');
  });

  it('validates and draws a PNG an agent can look at', async () => {
    const result = await call('diagram_render_png', { src: SRC, scale: 1 });
    const image = result.content.find((part) => part.type === 'image');
    expect(image?.type === 'image' && image.mimeType).toBe('image/png');
    const png = Buffer.from(image?.type === 'image' ? image.data : '', 'base64');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(result.structured).toMatchObject({ width: 1080, height: 606 });

    const checked = await call('diagram_validate', { src: SRC });
    expect(text(checked)).toContain('No issues.');
  });
});
