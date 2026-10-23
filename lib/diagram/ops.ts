// Small edits to a diagram, for agents and the CLI: each takes the file's
// parsed JSON and returns a changed copy, so a caller never rewrites the
// whole file by hand. They work on the input form (no schema defaults filled
// in), so a saved edit changes only the lines it touched once
// formatDiagramJson writes it. A missing id or an id clash throws
// DiagramOpError with a stable code.

import type { DiagramInput, EdgeVariant, Side, Tone } from './schema.ts';

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

// A group's node ids, through the groups it lists as members.
function nodesOf(diagram: Input, groupId: string, seen = new Set<string>()): string[] {
  if (seen.has(groupId)) return [];
  seen.add(groupId);
  const group = (diagram.groups ?? []).find((candidate) => candidate.id === groupId);
  return (group?.members ?? []).flatMap((member) => ((diagram.groups ?? []).some((candidate) => candidate.id === member) ? nodesOf(diagram, member, seen) : [member]));
}

// Whether group `outer` lists `inner`, directly or through its member groups.
function reaches(diagram: Input, outer: string, inner: string, seen = new Set<string>()): boolean {
  if (seen.has(outer)) return false;
  seen.add(outer);
  const group = (diagram.groups ?? []).find((candidate) => candidate.id === outer);
  return (group?.members ?? []).some((member) => member === inner || reaches(diagram, member, inner, seen));
}

export interface NewNode {
  id: string;
  kind: string;
  label: string;
  sublabel?: string;
  tag?: string;
  note?: NoteInput;
  // The group the node joins. It also joins every group drawn around that
  // one: a group that holds all of its nodes without listing the group itself.
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
  if (group !== undefined) {
    const target = groupOf(next, group);
    const inside = new Set(nodesOf(next, target.id));
    for (const other of next.groups ?? []) {
      if (other === target || nodesOf(next, other.id).includes(id)) continue;
      const holds = new Set(nodesOf(next, other.id));
      if (inside.size && [...inside].every((member) => holds.has(member)) && !reaches(next, other.id, target.id)) other.members.push(id);
    }
    target.members.push(id);
  }
  next.nodes.push(node);
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

// Fields to change; `null` removes an optional one.
export interface NodeChange {
  label?: string;
  sublabel?: string | null;
  tag?: string | null;
  kind?: string;
}

export function updateNode(diagram: Input, id: string, change: NodeChange): Input {
  const next = structuredClone(diagram);
  const node = nodeOf(next, id);
  if (change.kind !== undefined && !next.kinds.some((candidate) => candidate.id === change.kind)) {
    throw new DiagramOpError('op/unknown-kind', `No kind has the id "${change.kind}".`);
  }
  if (change.label !== undefined) node.label = change.label;
  if (change.kind !== undefined) node.kind = change.kind;
  for (const field of ['sublabel', 'tag'] as const) {
    const value = change[field];
    if (value === null) delete node[field];
    else if (value !== undefined) node[field] = value;
  }
  return next;
}

// An edge's own fields, and where its route and label are pinned
// (layout.edges); `null` removes an optional one.
export interface EdgeChange {
  label?: string | null;
  detail?: string | null;
  variant?: EdgeVariant;
  bidirectional?: boolean;
  fromSide?: Side | null;
  toSide?: Side | null;
  labelDx?: number | null;
  labelDy?: number | null;
  labelAt?: [number, number] | null;
}

export function updateEdge(diagram: Input, id: string, change: EdgeChange): Input {
  const next = structuredClone(diagram);
  const edge = (next.edges ?? []).find((candidate) => candidate.id === id);
  if (!edge) throw new DiagramOpError('op/unknown-edge', `No edge has the id "${id}".`);
  for (const field of ['label', 'detail'] as const) {
    const value = change[field];
    if (value === null) delete edge[field];
    else if (value !== undefined) edge[field] = value;
  }
  if (change.variant !== undefined) {
    if (change.variant === 'default') delete edge.variant;
    else edge.variant = change.variant;
  }
  if (change.bidirectional !== undefined) {
    if (change.bidirectional) edge.bidirectional = true;
    else delete edge.bidirectional;
  }
  const pins = { ...(next.layout.edges?.[id] ?? {}) } as Record<string, unknown>;
  for (const field of ['fromSide', 'toSide', 'labelDx', 'labelDy', 'labelAt'] as const) {
    const value = change[field];
    if (value === null) delete pins[field];
    else if (value !== undefined) pins[field] = value;
  }
  const edges = { ...(next.layout.edges ?? {}) };
  if (Object.keys(pins).length) edges[id] = pins;
  else delete edges[id];
  if (Object.keys(edges).length) next.layout.edges = edges;
  else delete next.layout.edges;
  return next;
}

export interface GroupChange {
  label?: string;
  tone?: Tone;
  dashed?: boolean;
  // The full member list: node ids, or ids of groups whose nodes it wraps.
  members?: string[];
}

export function updateGroup(diagram: Input, id: string, change: GroupChange): Input {
  const next = structuredClone(diagram);
  const group = groupOf(next, id);
  if (change.members !== undefined) {
    const known = new Set([...next.nodes, ...(next.groups ?? [])].map((item) => item.id));
    const unknown = change.members.find((member) => !known.has(member) || member === id);
    if (unknown !== undefined) throw new DiagramOpError('op/unknown-member', `"${unknown}" cannot be a member of group "${id}".`);
    if (!change.members.length) throw new DiagramOpError('op/empty-group', `Group "${id}" needs a member; remove its nodes instead to drop it.`);
    group.members = change.members;
  }
  if (change.label !== undefined) group.label = change.label;
  if (change.tone !== undefined) group.tone = change.tone;
  if (change.dashed !== undefined) {
    if (change.dashed) group.dashed = true;
    else delete group.dashed;
  }
  return next;
}

export function removeEdge(diagram: Input, id: string): Input {
  const next = structuredClone(diagram);
  if (!(next.edges ?? []).some((edge) => edge.id === id)) throw new DiagramOpError('op/unknown-edge', `No edge has the id "${id}".`);
  next.edges = (next.edges ?? []).filter((edge) => edge.id !== id);
  if (next.layout.edges) {
    const { [id]: _removed, ...rest } = next.layout.edges;
    if (Object.keys(rest).length) next.layout.edges = rest;
    else delete next.layout.edges;
  }
  return next;
}
