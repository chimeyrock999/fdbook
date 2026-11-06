import { addNode, connect, DiagramOpError, moveNode, removeEdge as removeEdgeOp, removeNode, reorder } from '@fdbook/diagram/ops.ts';
import { laysItselfOut, type DiagramInput, type Side } from '@fdbook/diagram/schema.ts';
import type { SequenceLayer } from '@fdbook/diagram/sequence.ts';

// What the diagram editor changes, on the file's input form (no schema
// defaults filled in), so a save touches only the lines an edit changed.
// Each returns a changed copy. packages/diagram/src/edit/ops.ts has the edits agents
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
const NEW_NODE = { w: 160, h: 64 };

export const snap = (value: number) => Math.round(value / GRID) * GRID;

// An architecture's layout; one without it gets an empty one. A sequence or
// lifecycle has none, and an edit that would give it one is refused here, whatever
// reached it.
function layoutOf(diagram: Input) {
  if (!laysItselfOut(diagram.type)) return (diagram.layout ??= { nodes: {} });
  if (diagram.type === 'sequence') throw new DiagramOpError('op/sequence-has-no-layout', 'A sequence lays itself out from its order: reorder its participants or messages instead.');
  throw new DiagramOpError('op/lifecycle-has-no-layout', 'A lifecycle lays itself out from its main path and transitions.');
}

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
  const first = ids.map((id) => diagram.layout?.nodes[id]).find(Boolean);
  if (!first) return diagram;
  const sx = snap(first.x + dx) - first.x;
  const sy = snap(first.y + dy) - first.y;
  let next = diagram;
  for (const id of ids) if (id in (next.layout?.nodes ?? {})) next = moveNode(next, { id, dx: sx, dy: sy });
  return next;
}

type Rect = { x: number; y: number; width: number; height: number };

const GAP = 3 * GRID;
const clear = (box: Box, rect: Rect) => box.x + box.w + GAP <= rect.x || rect.x + rect.width + GAP <= box.x || box.y + box.h + GAP <= rect.y || rect.y + rect.height + GAP <= box.y;

export type Size = { w: number; h: number };

// The first spot where `size` fits in `bounds` without touching what is
// drawn (`taken`: node boxes and frames, as the scene has them), scanning
// rows from the top left; null when there is none.
export function roomFor(taken: readonly Rect[], bounds: Rect, size: Size = NEW_NODE): { x: number; y: number } | null {
  for (let y = bounds.y; y + size.h <= bounds.y + bounds.height; y += 2 * GRID) {
    for (let x = bounds.x; x + size.w <= bounds.x + bounds.width; x += 2 * GRID) {
      if (taken.every((rect) => clear({ x, y, ...size }, rect))) return { x, y };
    }
  }
  return null;
}

// Where a new node (or a copy of `size`) goes in the drawing's `width` by
// `height`: the first free spot, or below everything when none is free.
// Never to the right: a wider canvas shrinks all of its text.
export function freeSpot(taken: readonly Rect[], width: number, height: number, size: Size = NEW_NODE): { x: number; y: number } {
  const margin = 5 * GRID;
  const spot = roomFor(taken, { x: margin, y: margin, width: width - 2 * margin, height: height - 2 * margin }, size);
  if (spot) return spot;
  const bottom = Math.max(0, ...taken.map((rect) => rect.y + rect.height));
  return { x: margin, y: snap(bottom + GAP) };
}

// A new node of the first kind at `at` (its top left corner).
export function addNodeAt(diagram: Input, at: { x: number; y: number }): { diagram: Input; id: string } {
  const id = freeId(diagram, 'node');
  const box = { x: snap(at.x), y: snap(at.y), ...NEW_NODE };
  return { diagram: addNode(diagram, { id, kind: diagram.kinds[0].id, label: 'New node', at: box }), id };
}

// Where copies go: moved by `dx`, `dy` from what they copy, members of the
// frames in `join`, and, for a fixed canvas that must grow to hold them,
// its new `height` (placement.ts picks them, clear of the drawing).
export type Place = { dx: number; dy: number; join: readonly string[]; height?: number };

function grown(diagram: Input, height: number | undefined) {
  const layout = layoutOf(diagram);
  if (layout.canvas && height !== undefined && height > layout.canvas[1]) layout.canvas = [layout.canvas[0], height];
}

// Copies of the nodes in `ids` at `place`, with their notes and the edges
// between them. The answer lists the copies' ids in the order of `ids`.
export function duplicateNodes(diagram: Input, ids: readonly string[], place: Place): { diagram: Input; ids: string[] } {
  let next = structuredClone(diagram);
  const copies: string[] = [];
  for (const id of ids) {
    const node = next.nodes.find((candidate) => candidate.id === id);
    if (!node) continue;
    const copy = { ...structuredClone(node), id: freeId(next, node.id) };
    next.nodes.push(copy);
    for (const group of next.groups ?? []) if (place.join.includes(group.id)) group.members.push(copy.id);
    const { nodes } = layoutOf(next);
    const box = nodes[id] as Box | undefined;
    if (box) nodes[copy.id] = { ...box, x: box.x + place.dx, y: box.y + place.dy };
    copies.push(copy.id);
  }
  grown(next, place.height);
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
  const layout = layoutOf(next);
  if (layout.groups) layout.groups = without(layout.groups, id);
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

// A copy of the frame at `place`, around copies of the nodes inside it
// (the frames inside are not copied: the copy holds their nodes' copies),
// itself a member of the frames in `place.join`.
export function duplicateGroup(diagram: Input, id: string, place: Place): { diagram: Input; id: string } {
  const group = (diagram.groups ?? []).find((candidate) => candidate.id === id);
  if (!group) return { diagram, id };
  const { diagram: withNodes, ids } = duplicateNodes(diagram, groupNodes(diagram, id), { ...place, join: [] });
  const next = structuredClone(withNodes);
  const copy: GroupInput = { ...structuredClone(group), id: freeId(next, group.id), members: ids };
  for (const each of next.groups ?? []) if (place.join.includes(each.id)) each.members.push(copy.id);
  next.groups = [...(next.groups ?? []), copy];
  const layout = layoutOf(next);
  const pad = layout.groups?.[id];
  if (pad) layout.groups = { ...layout.groups, [copy.id]: { ...pad } };
  return { diagram: next, id: copy.id };
}

// A new edge from `from` to `to`, its ends pinned to the sides it was drawn between.
export function connectAt(diagram: Input, from: string, to: string, fromSide: Side, toSide: Side): { diagram: Input; id: string } {
  const next = connect(diagram, { from, to });
  const edge = next.edges?.at(-1);
  if (!edge) return { diagram, id: '' };
  const layout = layoutOf(next);
  layout.edges = { ...layout.edges, [edge.id]: { fromSide, toSide } };
  return { diagram: next, id: edge.id };
}

function removeEdgeIn(diagram: Input, id: string): Input {
  diagram.edges = (diagram.edges ?? []).filter((edge) => edge.id !== id);
  if (diagram.layout?.edges) diagram.layout.edges = without(diagram.layout.edges, id);
  return diagram;
}

// A sequence's segments and activations keep their ends (packages/diagram/src/edit/ops.ts).
export const removeEdge = (diagram: Input, id: string): Input => ((diagram.edges ?? []).some((edge) => edge.id === id) ? removeEdgeOp(diagram, id) : diagram);

// An edge's waypoints, on the grid; null clears them, so the route is
// planned again.
export function setWaypoints(diagram: Input, id: string, via: Point[] | null): Input {
  const next = structuredClone(diagram);
  const all = layoutOf(next);
  const layout = { ...all.edges?.[id] };
  if (via === null || via.length === 0) delete layout.via;
  else layout.via = via.map(([x, y]) => [snap(x), snap(y)] as Point);
  all.edges = { ...all.edges, [id]: layout };
  if (Object.keys(layout).length === 0) all.edges = without(all.edges, id);
  if (Object.keys(all.edges).length === 0) delete all.edges;
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

// A new kind for the legend; `node`, when given, takes it.
export function addKind(diagram: Input, node?: string): { diagram: Input; id: string } {
  const next = structuredClone(diagram);
  const id = freeId(next, 'kind');
  next.kinds = [...next.kinds, { id, label: 'New kind', tone: 'blue' }];
  if (node !== undefined) next.nodes = next.nodes.map((each) => (each.id === node ? { ...each, kind: id } : each));
  return { diagram: next, id };
}

// Removes a kind no node is of; one still in use stays.
export function removeKind(diagram: Input, id: string): Input {
  if (diagram.nodes.some((node) => node.kind === id) || diagram.kinds.length <= 1) return diagram;
  const next = structuredClone(diagram);
  next.kinds = next.kinds.filter((kind) => kind.id !== id);
  return next;
}

// An edge's end sides; undefined leaves the router to pick.
export function setEdgeSides(diagram: Input, id: string, sides: { fromSide?: Side; toSide?: Side }): Input {
  const next = structuredClone(diagram);
  const all = layoutOf(next);
  const layout = patched({ ...all.edges?.[id] }, sides);
  all.edges = { ...all.edges, [id]: layout };
  if (Object.keys(layout).length === 0) all.edges = without(all.edges, id);
  if (Object.keys(all.edges).length === 0) delete all.edges;
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

// A sequence's edits: its order is its layout (packages/diagram/src/edit/ops.ts reorder).

// The column a participant dragged to `x` lands in.
export function participantIndexAt(layer: SequenceLayer, id: string, x: number) {
  return layer.lifelines.filter((line) => line.node !== id && line.x < x).length;
}

// The place in the timeline a message dragged to `y` lands in, among the
// others; null when it stays where it is.
export function messageIndexAt(layer: SequenceLayer, id: string, y: number): number | null {
  const others = layer.messages.filter((message) => message.edge.id !== id);
  const index = others.filter((message) => message.y < y).length;
  return layer.messages.findIndex((message) => message.edge.id === id) === index ? null : index;
}

export const moveParticipant = (diagram: Input, id: string, index: number) => reorder(diagram, 'nodes', id, index);
export const moveMessage = (diagram: Input, id: string, index: number) => reorder(diagram, 'edges', id, index);

// A new message from `from` to `to`, after the last message above `y`.
// Dropped inside a segment's frame but above its first message or below its
// last one, it joins that segment, which now starts or ends with it.
export function addMessage(diagram: Input, layer: SequenceLayer, from: string, to: string, y: number): { diagram: Input; id: string } {
  const id = freeId(diagram, `${from}-${to}`);
  const above = layer.messages.filter((message) => message.y < y).at(-1);
  const next = connect(diagram, { id, from, to, label: 'message', after: above ? above.edge.id : null });
  const yOf = new Map(layer.messages.map((message) => [message.edge.id, message.y]));
  const hit = layer.segments.find(({ frame }) => y >= frame.y && y <= frame.y + frame.height);
  if (hit) {
    const { segment } = hit;
    const edge = y < (yOf.get(segment.from) ?? -Infinity) ? 'from' : segment.to === above?.edge.id ? 'to' : null;
    if (edge) next.segments = (next.segments ?? []).map((each) => (each.from === segment.from && each.to === segment.to ? { ...each, [edge]: id } : each));
  }
  return { diagram: next, id };
}

// A new participant, the last column.
export function addParticipant(diagram: Input): { diagram: Input; id: string } {
  const id = freeId(diagram, 'participant');
  return { diagram: addNode(diagram, { id, kind: diagram.kinds[0].id, label: 'Participant' }), id };
}

// A lifecycle's edits: the layout places every state and route.

// A new transition from `from` to `to` (the same state for a self-transition).
export function addTransition(diagram: Input, from: string, to: string): { diagram: Input; id: string } {
  const id = freeId(diagram, `${from}-${to}`);
  return { diagram: connect(diagram, { id, from, to, label: 'event' }), id };
}

// A new state, placed by the layout; a lifecycle with no main path yet
// starts one with it.
export function addState(diagram: Input): { diagram: Input; id: string } {
  const id = freeId(diagram, 'state');
  const next = addNode(diagram, { id, kind: diagram.kinds[0].id, label: 'State' });
  if (!(next.mainPath ?? []).length) next.mainPath = [id];
  return { diagram: next, id };
}

// The main path with `id` moved to `index`, removed (`null`), or added at the end.
export function setMainPath(diagram: Input, id: string, index: number | null): Input {
  const next = structuredClone(diagram);
  const path = (next.mainPath ?? []).filter((step) => step !== id);
  if (index !== null) path.splice(Math.max(0, Math.min(index, path.length)), 0, id);
  next.mainPath = path;
  return next;
}
