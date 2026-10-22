import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diagramTools } from '../../../server/mcp/diagram-tools';
import type { StudioToolContext, ToolResult } from '../../../server/mcp/tool';
import type { DiagramInput } from '../../../../../lib/diagram/schema';
import { toolContext } from '../../support/studio-files';
import { DEMO_DIAGRAM, makeWorktree, type Worktree } from '../../support/studio';

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

  it('refuses a src outside diagrams/', async () => {
    for (const src of ['../content/notes/index', '../../package']) {
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
