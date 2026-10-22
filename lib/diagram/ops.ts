// Small edits to a diagram, for agents and the CLI: each takes the file's
// parsed JSON and returns a changed copy, so a caller never rewrites the
// whole file by hand. They work on the input form (no schema defaults filled
// in), so a saved edit changes only the lines it touched once
// formatDiagramJson writes it. A missing id or an id clash throws
// DiagramOpError with a stable code.

import type { DiagramInput, EdgeVariant } from './schema.ts';

type Input = DiagramInput;
type NodeInput = Input['nodes'][number];
type EdgeInput = NonNullable<Input['edges']>[number];
type NoteInput = NonNullable<NodeInput['note']>;
type Box = { x: number; y: number; w: number; h: number };

export class DiagramOpError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DiagramOpError';
    this.code = code;
  }
}

const allIds = (diagram: Input) => new Set([
  ...diagram.kinds, ...(diagram.badges ?? []), ...diagram.nodes, ...(diagram.groups ?? []), ...(diagram.edges ?? []), ...(diagram.lanes ?? []),
].map((item) => item.id));

function freeId(diagram: Input, id: string) {
  if (allIds(diagram).has(id)) throw new DiagramOpError('op/id-taken', `The id "${id}" is already used in this diagram.`);
}

function nodeOf(diagram: Input, id: string) {
  const node = diagram.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new DiagramOpError('op/unknown-node', `No node has the id "${id}".`);
  return node;
}

function groupOf(diagram: Input, id: string) {
  const group = (diagram.groups ?? []).find((candidate) => candidate.id === id);
  if (!group) throw new DiagramOpError('op/unknown-group', `No group has the id "${id}".`);
  return group;
}

export interface NewNode {
  id: string;
  kind: string;
  label: string;
  sublabel?: string;
  tag?: string;
  note?: NoteInput;
  // The group the node joins; it also joins every group around that one.
  group?: string;
  // Where it goes; without one, `layoutDiagram` places it.
  at?: Box;
}

export function addNode(diagram: Input, { id, kind, label, sublabel, tag, note, group, at }: NewNode): Input {
  const next = structuredClone(diagram);
  freeId(next, id);
  if (!next.kinds.some((candidate) => candidate.id === kind)) {
    throw new DiagramOpError('op/unknown-kind', `No kind has the id "${kind}"; the diagram lists ${next.kinds.map((candidate) => `"${candidate.id}"`).join(', ')}.`);
  }
  const node: NodeInput = { id, kind, label };
  if (sublabel !== undefined) node.sublabel = sublabel;
  if (tag !== undefined) node.tag = tag;
  if (note !== undefined) node.note = note;
  next.nodes.push(node);
  if (group !== undefined) groupOf(next, group).members.push(id);
  if (at) next.layout.nodes[id] = { x: at.x, y: at.y, w: at.w, h: at.h };
  return next;
}

export interface NodeMove {
  id: string;
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  w?: number;
  h?: number;
}

export function moveNode(diagram: Input, { id, x, y, dx = 0, dy = 0, w, h }: NodeMove): Input {
  const next = structuredClone(diagram);
  nodeOf(next, id);
  const at = next.layout.nodes[id];
  if (!at && (x === undefined || y === undefined || w === undefined || h === undefined)) {
    throw new DiagramOpError('op/unplaced-node', `Node "${id}" has no position yet: give x, y, w and h, or run layout first.`);
  }
  const box = at ?? { x: 0, y: 0, w: 0, h: 0 };
  next.layout.nodes[id] = { x: (x ?? box.x) + dx, y: (y ?? box.y) + dy, w: w ?? box.w, h: h ?? box.h };
  return next;
}

export interface NewEdge {
  // Defaults to "<from>-<to>", numbered when that is taken.
  id?: string;
  from: string;
  to: string;
  label?: string;
  detail?: string;
  variant?: EdgeVariant;
  bidirectional?: boolean;
}

export function connect(diagram: Input, { id, from, to, label, detail, variant, bidirectional }: NewEdge): Input {
  const next = structuredClone(diagram);
  const ends = new Set([...next.nodes, ...(next.groups ?? [])].map((item) => item.id));
  for (const end of [from, to]) {
    if (!ends.has(end)) throw new DiagramOpError('op/unknown-endpoint', `No node or group has the id "${end}".`);
  }
  let edgeId = id ?? `${from}-${to}`;
  if (id === undefined) {
    const taken = allIds(next);
    for (let count = 2; taken.has(edgeId); count += 1) edgeId = `${from}-${to}-${count}`;
  }
  freeId(next, edgeId);
  const edge: EdgeInput = { id: edgeId, from, to };
  if (label !== undefined) edge.label = label;
  if (detail !== undefined) edge.detail = detail;
  if (variant !== undefined && variant !== 'default') edge.variant = variant;
  if (bidirectional) edge.bidirectional = true;
  next.edges = [...(next.edges ?? []), edge];
  return next;
}

// Sets a node's note, or removes it with `null`.
export function setNote(diagram: Input, id: string, note: NoteInput | null): Input {
  const next = structuredClone(diagram);
  const node = nodeOf(next, id);
  if (note === null) delete node.note;
  else node.note = note;
  return next;
}

// Removes a node with its edges, its group memberships (and a group left
// empty, in turn) and its layout entries.
export function removeNode(diagram: Input, id: string): Input {
  const next = structuredClone(diagram);
  nodeOf(next, id);
  const gone = new Set([id]);
  next.nodes = next.nodes.filter((node) => node.id !== id);
  for (let changed = true; changed;) {
    changed = false;
    for (const group of next.groups ?? []) {
      group.members = group.members.filter((member) => !gone.has(member));
      if (!group.members.length && !gone.has(group.id)) {
        gone.add(group.id);
        changed = true;
      }
    }
  }
  if (next.groups) next.groups = next.groups.filter((group) => !gone.has(group.id));
  const edges = (next.edges ?? []).filter((edge) => gone.has(edge.from) || gone.has(edge.to));
  if (next.edges) next.edges = next.edges.filter((edge) => !edges.includes(edge));
  const { layout } = next;
  for (const key of gone) {
    delete layout.nodes[key];
    if (layout.groups) delete layout.groups[key];
  }
  for (const edge of edges) if (layout.edges) delete layout.edges[edge.id];
  return next;
}
