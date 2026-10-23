import { addNode, connect, moveNode, removeNode } from '@site/lib/diagram/ops';
import type { DiagramInput, Side } from '@site/lib/diagram/schema';

// What the diagram editor changes, on the file's input form (no schema
// defaults filled in), so a save touches only the lines an edit changed.
// Each returns a changed copy. lib/diagram/ops.ts has the edits agents
// share; these are the editor's own: duplicates, frames, cards, waypoints.

export type Input = DiagramInput;
export type NodeInput = Input['nodes'][number];
export type EdgeInput = NonNullable<Input['edges']>[number];
export type GroupInput = NonNullable<Input['groups']>[number];
export type CardInput = NonNullable<Input['cards']>[number];
export type KindInput = Input['kinds'][number];
export type Point = [number, number];
type Box = { x: number; y: number; w: number; h: number };

// Nodes land on this grid when they are dragged or added.
export const GRID = 8;
// How far a duplicate sits from what it copies.
const OFFSET = 3 * GRID;
const NEW_NODE = { w: 160, h: 64 };

export const snap = (value: number) => Math.round(value / GRID) * GRID;

// A record without `key`.
const without = <T>(record: Record<string, T>, key: string) => Object.fromEntries(Object.entries(record).filter(([each]) => each !== key));

const allIds = (diagram: Input) => new Set([
  ...diagram.kinds, ...(diagram.badges ?? []), ...diagram.nodes, ...(diagram.groups ?? []), ...(diagram.edges ?? []), ...(diagram.lanes ?? []),
].map((item) => item.id));

// `base`, or `base-2`, `base-3`… when that is taken.
export function freeId(diagram: Input, base: string) {
  const taken = allIds(diagram);
  if (!taken.has(base)) return base;
  let count = 2;
  while (taken.has(`${base}-${String(count)}`)) count += 1;
  return `${base}-${String(count)}`;
}

// A node's box moved to `x`, `y` on the grid.
export function placeNode(diagram: Input, id: string, x: number, y: number): Input {
  return moveNode(diagram, { id, x: snap(x), y: snap(y) });
}

// Every node in `ids` moved by `dx`, `dy`, keeping their spacing; the
// first one lands on the grid.
export function moveNodes(diagram: Input, ids: readonly string[], dx: number, dy: number): Input {
  const first = ids.map((id) => diagram.layout.nodes[id]).find(Boolean);
  if (!first) return diagram;
  const sx = snap(first.x + dx) - first.x;
  const sy = snap(first.y + dy) - first.y;
  let next = diagram;
  for (const id of ids) if (id in next.layout.nodes) next = moveNode(next, { id, dx: sx, dy: sy });
  return next;
}

type Rect = { x: number; y: number; width: number; height: number };

const GAP = 3 * GRID;
const clear = (box: Box, rect: Rect) => box.x + box.w + GAP <= rect.x || rect.x + rect.width + GAP <= box.x || box.y + box.h + GAP <= rect.y || rect.y + rect.height + GAP <= box.y;

// Where a new node fits without touching what is drawn (`taken`: node
// boxes and frames, as the scene has them) inside the drawing's `width` by
// `height`, scanning rows from the top left; below everything when nothing
// fits. Never to the right: a wider canvas shrinks all of its text.
export function freeSpot(taken: readonly Rect[], width: number, height: number): { x: number; y: number } {
  const margin = 5 * GRID;
  for (let y = margin; y + NEW_NODE.h <= height - margin; y += 2 * GRID) {
    for (let x = margin; x + NEW_NODE.w <= width - margin; x += 2 * GRID) {
      if (taken.every((rect) => clear({ x, y, ...NEW_NODE }, rect))) return { x, y };
    }
  }
  const bottom = Math.max(0, ...taken.map((rect) => rect.y + rect.height));
  return { x: margin, y: snap(bottom + GAP) };
}

// A new node of the first kind at `at` (its top left corner).
export function addNodeAt(diagram: Input, at: { x: number; y: number }): { diagram: Input; id: string } {
  const id = freeId(diagram, 'node');
  const box = { x: snap(at.x), y: snap(at.y), ...NEW_NODE };
  return { diagram: addNode(diagram, { id, kind: diagram.kinds[0].id, label: 'New node', at: box }), id };
}

// The groups that list `id` among their members.
const groupsWith = (diagram: Input, id: string) => (diagram.groups ?? []).filter((group) => group.members.includes(id));

// Copies of the nodes in `ids` beside them, in the same frames, with their
// notes. The answer maps each id to its copy's.
export function duplicateNodes(diagram: Input, ids: readonly string[]): { diagram: Input; ids: string[] } {
  let next = structuredClone(diagram);
  const copies: string[] = [];
  for (const id of ids) {
    const node = next.nodes.find((candidate) => candidate.id === id);
    if (!node) continue;
    const copy = { ...structuredClone(node), id: freeId(next, node.id) };
    next.nodes.push(copy);
    for (const group of groupsWith(next, id)) group.members.push(copy.id);
    const box = next.layout.nodes[id] as Box | undefined;
    if (box) next.layout.nodes[copy.id] = { ...box, x: box.x + OFFSET, y: box.y + OFFSET };
    copies.push(copy.id);
  }
  // Edges between two copied nodes come along too.
  const copied = new Map(ids.map((id, index) => [id, copies[index]]));
  for (const edge of diagram.edges ?? []) {
    const from = copied.get(edge.from);
    const to = copied.get(edge.to);
    if (from === undefined || to === undefined) continue;
    next = connect(next, { from, to, label: edge.label, detail: edge.detail, variant: edge.variant, bidirectional: edge.bidirectional });
  }
  return { diagram: next, ids: copies };
}

export function removeNodes(diagram: Input, ids: readonly string[]): Input {
  let next = diagram;
  for (const id of ids) if (next.nodes.some((node) => node.id === id)) next = removeNode(next, id);
  return next;
}

// A new frame around the nodes in `ids`; it sits inside the innermost frame
// that already holds all of them.
export function addGroup(diagram: Input, ids: readonly string[]): { diagram: Input; id: string } {
  const next = structuredClone(diagram);
  const id = freeId(next, 'frame');
  const parent = (next.groups ?? []).filter((group) => ids.every((member) => group.members.includes(member)));
  next.groups = [...(next.groups ?? []), { id, label: 'New frame', members: [...ids] }];
  // The parent now wraps the new frame, which wraps the nodes.
  for (const group of parent) group.members = [...group.members.filter((member) => !ids.includes(member)), id];
  return { diagram: next, id };
}

// Removes a frame and the edges that end on it; its members stay, and the
// frames around it take them over.
export function removeGroup(diagram: Input, id: string): Input {
  const next = structuredClone(diagram);
  const group = (next.groups ?? []).find((candidate) => candidate.id === id);
  if (!group) return diagram;
  next.groups = (next.groups ?? []).filter((candidate) => candidate.id !== id);
  for (const outer of next.groups) {
    if (!outer.members.includes(id)) continue;
    outer.members = [...new Set(outer.members.flatMap((member) => (member === id ? group.members : [member])))];
  }
  const gone = (next.edges ?? []).filter((edge) => edge.from === id || edge.to === id).map((edge) => edge.id);
  for (const edge of gone) removeEdgeIn(next, edge);
  if (next.layout.groups) next.layout.groups = without(next.layout.groups, id);
  return next;
}

// The nodes inside a frame, through the frames it holds.
export function groupNodes(diagram: Input, id: string, seen = new Set<string>()): string[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const group = (diagram.groups ?? []).find((candidate) => candidate.id === id);
  if (!group) return [];
  const nodes = new Set(diagram.nodes.map((node) => node.id));
  return [...new Set(group.members.flatMap((member) => (nodes.has(member) ? [member] : groupNodes(diagram, member, seen))))];
}

// The frame and the frames inside it.
function framesIn(diagram: Input, id: string, seen = new Set<string>()): Set<string> {
  if (seen.has(id)) return seen;
  seen.add(id);
  const group = (diagram.groups ?? []).find((candidate) => candidate.id === id);
  for (const member of group?.members ?? []) if ((diagram.groups ?? []).some((candidate) => candidate.id === member)) framesIn(diagram, member, seen);
  return seen;
}

// A copy of the frame, beside it, around copies of the nodes inside it (the
// frames inside are not copied: the copy holds their nodes' copies), in the
// same frames as the original.
export function duplicateGroup(diagram: Input, id: string): { diagram: Input; id: string } {
  const group = (diagram.groups ?? []).find((candidate) => candidate.id === id);
  if (!group) return { diagram, id };
  const { diagram: withNodes, ids } = duplicateNodes(diagram, groupNodes(diagram, id));
  const next = structuredClone(withNodes);
  const inside = framesIn(diagram, id);
  const copy: GroupInput = { ...structuredClone(group), id: freeId(next, group.id), members: ids };
  for (const each of next.groups ?? []) {
    if (inside.has(each.id)) each.members = each.members.filter((member) => !ids.includes(member));
    else if (each.members.includes(id)) each.members.push(copy.id);
  }
  next.groups = [...(next.groups ?? []), copy];
  const pad = next.layout.groups?.[id];
  if (pad) next.layout.groups = { ...next.layout.groups, [copy.id]: { ...pad } };
  return { diagram: next, id: copy.id };
}

// A new edge from `from` to `to`, its ends pinned to the sides it was drawn between.
export function connectAt(diagram: Input, from: string, to: string, fromSide: Side, toSide: Side): { diagram: Input; id: string } {
  const next = connect(diagram, { from, to });
  const edge = next.edges?.at(-1);
  if (!edge) return { diagram, id: '' };
  next.layout.edges = { ...next.layout.edges, [edge.id]: { fromSide, toSide } };
  return { diagram: next, id: edge.id };
}

function removeEdgeIn(diagram: Input, id: string): Input {
  diagram.edges = (diagram.edges ?? []).filter((edge) => edge.id !== id);
  if (diagram.layout.edges) diagram.layout.edges = without(diagram.layout.edges, id);
  return diagram;
}

export const removeEdge = (diagram: Input, id: string): Input => removeEdgeIn(structuredClone(diagram), id);

// An edge's waypoints, on the grid; null clears them, so the route is
// planned again.
export function setWaypoints(diagram: Input, id: string, via: Point[] | null): Input {
  const next = structuredClone(diagram);
  const layout = { ...next.layout.edges?.[id] };
  if (via === null || via.length === 0) delete layout.via;
  else layout.via = via.map(([x, y]) => [snap(x), snap(y)] as Point);
  next.layout.edges = { ...next.layout.edges, [id]: layout };
  if (Object.keys(layout).length === 0) next.layout.edges = without(next.layout.edges, id);
  if (Object.keys(next.layout.edges).length === 0) delete next.layout.edges;
  return next;
}

// Sets fields of an item; an `undefined` (or empty text) removes the field.
function patched<T extends object>(item: T, patch: Partial<T>): T {
  const next = { ...item };
  for (const [key, value] of Object.entries(patch) as [keyof T, T[keyof T] | undefined][]) {
    if (value === undefined || value === '') Reflect.deleteProperty(next, key);
    else next[key] = value;
  }
  return next;
}

export function updateNode(diagram: Input, id: string, patch: Partial<NodeInput>): Input {
  const next = structuredClone(diagram);
  next.nodes = next.nodes.map((node) => (node.id === id ? patched(node, patch) : node));
  return next;
}

export function updateEdge(diagram: Input, id: string, patch: Partial<EdgeInput>): Input {
  const next = structuredClone(diagram);
  next.edges = (next.edges ?? []).map((edge) => (edge.id === id ? patched(edge, patch) : edge));
  return next;
}

export function updateGroup(diagram: Input, id: string, patch: Partial<GroupInput>): Input {
  const next = structuredClone(diagram);
  next.groups = (next.groups ?? []).map((group) => (group.id === id ? patched(group, patch) : group));
  return next;
}

export function updateKind(diagram: Input, id: string, patch: Partial<KindInput>): Input {
  const next = structuredClone(diagram);
  next.kinds = next.kinds.map((kind) => (kind.id === id ? patched(kind, patch) : kind));
  return next;
}

// An edge's end sides; undefined leaves the router to pick.
export function setEdgeSides(diagram: Input, id: string, sides: { fromSide?: Side; toSide?: Side }): Input {
  const next = structuredClone(diagram);
  const layout = patched({ ...next.layout.edges?.[id] }, sides);
  next.layout.edges = { ...next.layout.edges, [id]: layout };
  if (Object.keys(layout).length === 0) next.layout.edges = without(next.layout.edges, id);
  if (Object.keys(next.layout.edges).length === 0) delete next.layout.edges;
  return next;
}

export function addCard(diagram: Input): Input {
  const next = structuredClone(diagram);
  next.cards = [...(next.cards ?? []), { title: 'New card', items: ['One line.'] }];
  return next;
}

export function duplicateCard(diagram: Input, index: number): Input {
  const next = structuredClone(diagram);
  const cards = next.cards ?? [];
  if (!cards[index]) return diagram;
  cards.splice(index + 1, 0, structuredClone(cards[index]));
  next.cards = cards;
  return next;
}

export function removeCard(diagram: Input, index: number): Input {
  const next = structuredClone(diagram);
  next.cards = (next.cards ?? []).filter((_, at) => at !== index);
  if (next.cards.length === 0) delete next.cards;
  return next;
}

export function updateCard(diagram: Input, index: number, patch: Partial<CardInput>): Input {
  const next = structuredClone(diagram);
  next.cards = (next.cards ?? []).map((card, at) => (at === index ? patched(card, patch) : card));
  return next;
}
