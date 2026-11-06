import { z } from 'zod';
import { formatDiagramJson } from '@site/lib/diagram/format.ts';
import { addNode, connect, DiagramOpError, moveNode, removeEdge, removeNode, reorder, setNote, updateEdge, updateGroup, updateNode } from '@site/lib/diagram/ops.ts';
import { EDGE_VARIANTS, laysItselfOut, SIDES, TONES, type DiagramInput } from '@site/lib/diagram/schema.ts';
import { diagramPathOf } from '@site/lib/diagram/source.ts';
import { checkSchema, validateDiagram, type DiagramIssue } from '@site/lib/diagram/validate.ts';
import { listEditableFiles } from '../files/store.ts';
import { classifyPath, DIAGRAM_SUFFIX, DIAGRAMS_DIR } from '../security/asset-types.ts';
import type { StudioTool, StudioToolContext, ToolResult } from './tool.ts';

// The diagram tools of the Studio MCP, mounted beside the note tools
// (server/studio-server.ts):
// small edits to `diagrams/**/*.diagram.json` in the change request's
// worktree, so an agent never rewrites a whole file or a coordinate by hand.
// Every write goes through ctx.files with the mtime it read, lays out any
// node left without a position, and answers with the checks of
// lib/diagram/validate.ts. The format is in diagrams/README.md. Layout
// (elkjs) and drawing (resvg) load on first use, from the repository root's
// packages, so the server starts without them.

class ToolError extends Error {}

const src = z.string().min(1).describe('The diagram, as <Diagram src> names it: its path under diagrams/ without .diagram.json, e.g. "data-platform/processing/apache-spark/spark-logic-to-execution".');
const id = z.string().regex(/^[A-Za-z][\w-]*$/);
const note = z.object({
  role: z.string().min(1).describe('What the node does, as MDX (paragraphs, lists, **bold**, `code`, links); no {expressions} or imports.'),
  badge: id.optional().describe('A badge id the diagram lists in badges.'),
  points: z.array(z.string().min(1)).optional().describe('Short inline MDX points.'),
});

function pathOf(name: string) {
  const path = diagramPathOf(name);
  if (path === null || classifyPath(path) !== 'diagram') throw new ToolError(`not a diagram path: ${name}`);
  return path;
}

async function load(ctx: StudioToolContext, name: string) {
  const path = pathOf(name);
  const file = await ctx.files.read(path);
  if (!file) throw new ToolError(`${path} does not exist; diagram_list names the diagrams, diagram_create makes one`);
  let diagram: DiagramInput;
  try {
    diagram = JSON.parse(file.content) as DiagramInput;
  } catch (error) {
    throw new ToolError(`${path} is not JSON: ${(error as Error).message}`);
  }
  return { path, diagram, mtimeMs: file.mtimeMs };
}

// An edit needs the file's shape (kinds, nodes, layout.nodes) to be sound;
// one the schema refuses is fixed by hand first.
function editable(path: string, diagram: unknown) {
  const issues = checkSchema(diagram);
  if (issues.length) throw new ToolError(`${path} does not match the diagram format; fix it by hand first:\n${issues.map(issueLine).join('\n')}`);
}

const conflict = (error: unknown) => error instanceof Error && error.name === 'FileConflictError';

async function save(ctx: StudioToolContext, path: string, diagram: DiagramInput, baseMtime: number | null) {
  try {
    return (await ctx.files.write(path, formatDiagramJson(diagram), { baseMtime })).mtimeMs;
  } catch (error) {
    if (conflict(error)) throw new ToolError(`${path} changed since it was read (someone saved it meanwhile); read it again and redo the edit`);
    throw error;
  }
}

const issueLine = (issue: DiagramIssue) => `- ${issue.severity} ${issue.code}${issue.path ? ` at ${issue.path}` : ''}: ${issue.message}${issue.fix ? ` Fix: ${issue.fix}.` : ''}`;

function report(lead: string, issues: DiagramIssue[], structured: Record<string, unknown>): ToolResult {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const summary = issues.length ? `${String(issues.length)} issue${issues.length === 1 ? '' : 's'} (${String(errors)} error${errors === 1 ? '' : 's'}):\n${issues.map(issueLine).join('\n')}` : 'No issues.';
  return { content: [{ type: 'text', text: `${lead}\n${summary}` }], structured: { ...structured, issues } };
}

// Runs one edit: read, change, place what has no position, save, check.
async function edit(ctx: StudioToolContext, name: string, change: (diagram: DiagramInput) => DiagramInput, verb: string) {
  const { path, diagram, mtimeMs } = await load(ctx, name);
  editable(path, diagram);
  const { layoutDiagram } = await import('@site/lib/diagram/auto-layout.ts');
  const { diagram: laid, placed } = await layoutDiagram(change(diagram));
  const saved = await save(ctx, path, laid, mtimeMs);
  const placedNote = placed.length ? ` Placed ${placed.join(', ')}.` : '';
  return report(`${verb} in ${path}.${placedNote}`, validateDiagram(laid).issues, { path, mtimeMs: saved, placed });
}

// A tool whose failures (an unknown id, a stale read) come back as an error
// result the agent can act on, not as a thrown error.
function tool<I extends z.ZodType>(definition: StudioTool<I>): StudioTool<I> {
  return {
    ...definition,
    async run(args, ctx) {
      try {
        return await definition.run(args, ctx);
      } catch (error) {
        if (!(error instanceof ToolError || error instanceof DiagramOpError)) throw error;
        const code = error instanceof DiagramOpError ? `${error.code}: ` : '';
        return { content: [{ type: 'text', text: `${code}${error.message}` }], isError: true };
      }
    },
  };
}

export const diagramTools: StudioTool[] = [
  tool({
    name: 'diagram_list',
    description: 'Lists the diagrams of the change request (diagrams/**/*.diagram.json) by the src a note embeds them with: <Diagram src="…" />.',
    access: 'read',
    input: z.object({}),
    async run(_args, ctx) {
      const files = (await listEditableFiles(ctx.root)).filter((file) => file.kind === 'diagram');
      const names = files.map((file) => file.path.slice(DIAGRAMS_DIR.length + 1, -DIAGRAM_SUFFIX.length));
      return { content: [{ type: 'text', text: names.length ? names.join('\n') : 'No diagrams yet.' }], structured: { diagrams: names } };
    },
  }),
  tool({
    name: 'diagram_read',
    description: 'Reads a diagram file as JSON, with its checks. The format (type, kinds, badges, nodes, groups, edges, lanes, cards, layout; a sequence\'s segments and activations, a lifecycle\'s mainPath) is in diagrams/README.md and diagrams/diagram.schema.json.',
    access: 'read',
    input: z.object({ src }),
    async run({ src: name }, ctx) {
      const { path, diagram, mtimeMs } = await load(ctx, name);
      const { issues } = validateDiagram(diagram);
      const result = report(`${path}:\n${formatDiagramJson(diagram)}`, issues, { path, mtimeMs, diagram });
      return result;
    },
  }),
  tool({
    name: 'diagram_validate',
    description: 'Checks a diagram: schema, ids, positions, overlapping nodes, frames covering non-members, colliding labels, text that overflows or reads under 6px at desktop width. Each issue has a stable code, the place in the file and a fix.',
    access: 'read',
    input: z.object({ src }),
    async run({ src: name }, ctx) {
      const { path, diagram, mtimeMs } = await load(ctx, name);
      return report(`Checked ${path}.`, validateDiagram(diagram).issues, { path, mtimeMs });
    },
  }),
  tool({
    name: 'diagram_render_png',
    description: 'Draws a diagram as a PNG, as the note shows it, so you can look at the result. Use it after every change you mean to hand over.',
    access: 'read',
    input: z.object({
      src,
      theme: z.enum(['light', 'dark']).optional().describe('Default light.'),
      expanded: z.boolean().optional().describe('Also show node tags and second label lines, as the expanded view does.'),
      scale: z.number().min(0.5).max(4).optional().describe('Pixels per canvas unit; default 2.'),
    }),
    async run({ src: name, theme, expanded, scale }, ctx) {
      const { path, diagram } = await load(ctx, name);
      const { drawDiagramPng } = await import('@site/lib/diagram/png.ts');
      const { png, width, height, issues } = drawDiagramPng(diagram, { theme, expanded, scale });
      if (!png) return { ...report(`${path} does not draw.`, issues, { path }), isError: true };
      const result = report(`${path}, ${String(width)}×${String(height)}px.`, issues, { path, width, height });
      return { ...result, content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }, ...result.content] };
    },
  }),
  tool({
    name: 'diagram_create',
    description: 'Creates a diagram from its content (title, kinds, nodes, edges, and optionally badges, groups, lanes, cards). Leave out layout.nodes: every node is placed automatically. Lanes are not: a diagram with lanes needs layout.lanes, a box per lane. With "type": "sequence" the nodes are the participants (columns, in order), the edges the messages (down the timeline, in order, each with a label), plus optional segments [{ label, from, to }] and activations [{ node, from, to }] naming message ids; a sequence has no groups, lanes or layout. With "type": "lifecycle" the nodes are the states, the edges the transitions (label, detail for the small note under it), and "mainPath" lists the states of the happy path in order, each step with a transition; the layout places every state itself. Then check it with diagram_render_png.',
    access: 'write',
    input: z.object({
      src,
      content: z.record(z.string(), z.unknown()).describe('The diagram without "version" and "$schema": { "type"?: "architecture" | "sequence" | "lifecycle", "title", "kinds": [{ "id", "label", "tone", "icon"? }], "nodes": [{ "id", "kind", "label", "sublabel"?, "note"? }], "edges"?: [{ "id", "from", "to", "label"?, "detail"?, "variant"? }], "groups"?, "badges"?, "lanes"?, "cards"?, "segments"?, "activations"?, "mainPath"? }.'),
    }),
    async run({ src: name, content }, ctx) {
      const path = pathOf(name);
      if (await ctx.files.read(path)) throw new ToolError(`${path} already exists; change it with the other diagram_* tools`);
      const depth = path.split('/').length - 2;
      // The file's own fields come first, whatever the content says of them.
      const rest = Object.fromEntries(Object.entries(content).filter(([key]) => key !== '$schema' && key !== 'version' && key !== 'layout'));
      // A sequence or lifecycle takes no layout; one given anyway is kept, for the check to name.
      const layout = content.layout ?? (laysItselfOut(content.type as string | undefined) ? undefined : { nodes: {} });
      const diagram = { $schema: `${'../'.repeat(depth)}diagram.schema.json`, version: 1, ...rest, ...(layout === undefined ? {} : { layout }) } as DiagramInput;
      editable(path, diagram);
      const { layoutDiagram } = await import('@site/lib/diagram/auto-layout.ts');
      const { diagram: laid, placed } = await layoutDiagram(diagram);
      const saved = await save(ctx, path, laid, null);
      return report(`Created ${path}.${laysItselfOut(diagram.type) ? '' : ` Placed ${String(placed.length)} node${placed.length === 1 ? '' : 's'}.`}`, validateDiagram(laid).issues, { path, mtimeMs: saved, placed });
    },
  }),
  tool({
    name: 'diagram_add_node',
    description: 'Adds a node, with its edges if given. Without `at` it is placed next to the nodes it connects to, clear of the others, and no existing node moves. In a sequence it is a participant, added as the last column (diagram_reorder moves it); in a lifecycle a state, placed by the layout (diagram_update mainPath puts it on the happy path). Neither takes `at` or `group`.',
    access: 'write',
    input: z.object({
      src,
      id,
      kind: id.describe('A kind id the diagram lists in kinds.'),
      label: z.string().min(1),
      sublabel: z.string().min(1).optional(),
      tag: z.string().min(1).optional(),
      note: note.optional(),
      group: id.optional().describe('A group id; the node becomes one of its members.'),
      at: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }).optional(),
      edges: z.array(z.object({
        from: id.optional(),
        to: id.optional(),
        label: z.string().min(1).optional(),
        variant: z.enum(EDGE_VARIANTS).optional(),
      })).optional().describe('Edges to or from the new node: give `from` for an edge into it, `to` for one out of it.'),
    }),
    async run({ src: name, edges = [], ...node }, ctx) {
      for (const edge of edges) {
        if ((edge.from === undefined) === (edge.to === undefined)) throw new ToolError('each edge of diagram_add_node gives exactly one of from and to; the other end is the new node');
      }
      return edit(ctx, name, (diagram) => edges.reduce(
        (next, { from, to, ...rest }) => connect(next, { from: from ?? node.id, to: to ?? node.id, ...rest }),
        addNode(diagram, node),
      ), `Added node "${node.id}"`);
    },
  }),
  tool({
    name: 'diagram_move',
    description: 'Moves or resizes a node: x/y set the top-left corner, dx/dy shift it, w/h resize it. Positions are SVG units on the canvas. Not for a sequence (use diagram_reorder) or a lifecycle (it places its states itself).',
    access: 'write',
    input: z.object({
      src,
      id,
      x: z.number().optional(),
      y: z.number().optional(),
      dx: z.number().optional(),
      dy: z.number().optional(),
      w: z.number().positive().optional(),
      h: z.number().positive().optional(),
    }),
    async run({ src: name, ...move }, ctx) {
      return edit(ctx, name, (diagram) => moveNode(diagram, move), `Moved "${move.id}"`);
    },
  }),
  tool({
    name: 'diagram_connect',
    description: 'Adds an edge between two nodes or groups. Variants: default, emphasis (the main path), dashed (optional or async), alert (a failure path), return (a reply). Routes and label places are planned automatically. In a sequence it is a message between two participants: give it a label, a detail for the small note under the arrow, and `after` to place it in the timeline (last by default). In a lifecycle it is a transition between states (a state may transition to itself); detail is the note under its label.',
    access: 'write',
    input: z.object({
      src,
      id: id.optional().describe('Defaults to "<from>-<to>".'),
      after: id.nullable().optional().describe('Sequence: the message this one follows; null puts it first.'),
      from: id,
      to: id,
      label: z.string().min(1).optional(),
      detail: z.string().min(1).optional().describe('A second, smaller label line, shown in the expanded view; in a sequence, the note under the arrow.'),
      variant: z.enum(EDGE_VARIANTS).optional(),
      bidirectional: z.boolean().optional(),
    }),
    async run({ src: name, ...edge }, ctx) {
      return edit(ctx, name, (diagram) => connect(diagram, edge), `Connected "${edge.from}" to "${edge.to}"`);
    },
  }),
  tool({
    name: 'diagram_set_note',
    description: 'Sets the note a reader sees when they click a node (role, optional badge and points), or removes it with null.',
    access: 'write',
    input: z.object({ src, id, note: note.nullable() }),
    async run({ src: name, id: nodeId, note: value }, ctx) {
      return edit(ctx, name, (diagram) => setNote(diagram, nodeId, value), `Set the note of "${nodeId}"`);
    },
  }),
  tool({
    name: 'diagram_update',
    description: 'Changes one node, edge or group, giving exactly one of them by id with the fields to change; null removes an optional field. A node: label, sublabel, tag, kind. An edge: label, detail, variant, bidirectional, and where it is pinned: fromSide/toSide, and labelDx/labelDy (shift the label) or labelAt (place it), the fix for a label/collision. A group: label, tone, dashed, and members (the full list). Or, for a sequence, the full list of segments or of activations, each naming its first and last message; for a lifecycle, the full mainPath.',
    access: 'write',
    input: z.object({
      src,
      node: z.object({
        id,
        label: z.string().min(1).optional(),
        sublabel: z.string().min(1).nullable().optional(),
        tag: z.string().min(1).nullable().optional(),
        kind: id.optional(),
      }).optional(),
      edge: z.object({
        id,
        label: z.string().min(1).nullable().optional(),
        detail: z.string().min(1).nullable().optional(),
        variant: z.enum(EDGE_VARIANTS).optional(),
        bidirectional: z.boolean().optional(),
        fromSide: z.enum(SIDES).nullable().optional(),
        toSide: z.enum(SIDES).nullable().optional(),
        labelDx: z.number().nullable().optional(),
        labelDy: z.number().nullable().optional(),
        labelAt: z.tuple([z.number(), z.number()]).nullable().optional(),
      }).optional(),
      group: z.object({
        id,
        label: z.string().min(1).optional(),
        tone: z.enum(TONES).optional(),
        dashed: z.boolean().optional(),
        members: z.array(id).optional(),
      }).optional(),
      segments: z.array(z.object({ label: z.string().min(1), from: id, to: id })).optional().describe('Sequence: every segment, a frame around the messages from `from` to `to`; [] removes them.'),
      activations: z.array(z.object({ node: id, from: id, to: id })).optional().describe('Sequence: every activation, a participant busy from message `from` to message `to`; [] removes them.'),
      mainPath: z.array(id).optional().describe('Lifecycle: the happy path, state ids in order from the initial state; each step needs a transition.'),
    }),
    async run({ src: name, node, edge, group, segments, activations, mainPath }, ctx) {
      if ([node, edge, group, segments, activations, mainPath].filter((each) => each !== undefined).length !== 1) {
        throw new ToolError('diagram_update changes exactly one of node, edge, group, segments, activations and mainPath');
      }
      if (mainPath !== undefined) {
        return edit(ctx, name, (diagram) => {
          if (diagram.type !== 'lifecycle') throw new ToolError('only a lifecycle has a mainPath');
          return { ...structuredClone(diagram), mainPath };
        }, 'Set the main path');
      }
      for (const [key, list] of [['segments', segments], ['activations', activations]] as const) {
        if (list === undefined) continue;
        return edit(ctx, name, (diagram) => {
          if (diagram.type !== 'sequence') throw new ToolError(`only a sequence has ${key}`);
          const next = structuredClone(diagram);
          if (key === 'segments') next.segments = list.length ? segments : undefined;
          else next.activations = list.length ? activations : undefined;
          return next;
        }, `Set the ${key}`);
      }
      if (node) {
        const { id: nodeId, ...change } = node;
        return edit(ctx, name, (diagram) => updateNode(diagram, nodeId, change), `Updated node "${nodeId}"`);
      }
      if (edge) {
        const { id: edgeId, ...change } = edge;
        return edit(ctx, name, (diagram) => updateEdge(diagram, edgeId, change), `Updated edge "${edgeId}"`);
      }
      if (!group) throw new ToolError('diagram_update changes exactly one of node, edge, group, segments, activations and mainPath');
      const { id: groupId, ...change } = group;
      return edit(ctx, name, (diagram) => updateGroup(diagram, groupId, change), `Updated group "${groupId}"`);
    },
  }),
  tool({
    name: 'diagram_reorder',
    description: 'Sequence: moves a participant to another column, or a message to another place in the timeline, by its new index (0 is the first). A segment or activation keeps its first and last message.',
    access: 'write',
    input: z.object({
      src,
      node: id.optional().describe('A participant to move.'),
      edge: id.optional().describe('A message to move.'),
      index: z.number().int().min(0),
    }),
    async run({ src: name, node, edge, index }, ctx) {
      if ((node === undefined) === (edge === undefined)) throw new ToolError('diagram_reorder moves exactly one of node and edge');
      return edit(ctx, name, (diagram) => {
        if (diagram.type === 'lifecycle') throw new ToolError('a lifecycle is laid out from its main path and transitions: change mainPath with diagram_update');
        if (diagram.type !== 'sequence') throw new ToolError('only a sequence is laid out by its order; use diagram_move');
        return node !== undefined ? reorder(diagram, 'nodes', node, index) : reorder(diagram, 'edges', edge ?? '', index);
      }, `Moved "${node ?? edge ?? ''}" to ${String(index)}`);
    },
  }),
  tool({
    name: 'diagram_remove_edge',
    description: 'Removes an edge and where it was pinned. In a sequence, a segment or activation that ended at that message ends at its neighbour.',
    access: 'write',
    input: z.object({ src, id }),
    async run({ src: name, id: edgeId }, ctx) {
      return edit(ctx, name, (diagram) => removeEdge(diagram, edgeId), `Removed edge "${edgeId}"`);
    },
  }),
  tool({
    name: 'diagram_remove_node',
    description: 'Removes a node with its edges, its group memberships (and a group left empty) and its layout entries.',
    access: 'write',
    input: z.object({ src, id }),
    async run({ src: name, id: nodeId }, ctx) {
      return edit(ctx, name, (diagram) => removeNode(diagram, nodeId), `Removed "${nodeId}"`);
    },
  }),
  tool({
    name: 'diagram_layout',
    description: 'Places every node that has no position yet, keeping the ones a person placed. With all: true, lays out the whole diagram again, which drops every hand-placed position, route pin and the canvas size; use it only for a diagram nobody arranged by hand. A sequence or lifecycle has nothing to place.',
    access: 'write',
    input: z.object({ src, all: z.boolean().optional() }),
    async run({ src: name, all }, ctx) {
      const { path, diagram, mtimeMs } = await load(ctx, name);
      editable(path, diagram);
      const { layoutDiagram } = await import('@site/lib/diagram/auto-layout.ts');
      const { diagram: laid, placed } = await layoutDiagram(diagram, { all });
      const saved = placed.length ? await save(ctx, path, laid, mtimeMs) : mtimeMs;
      const { type } = diagram as { type?: string };
      const none = laysItselfOut(type) ? `${path} is a ${type}: its structure lays it out, nothing to place.` : `Every node of ${path} already has a position.`;
      return report(placed.length ? `Placed ${placed.join(', ')} in ${path}.` : none, validateDiagram(laid).issues, { path, mtimeMs: saved, placed });
    },
  }),
];
