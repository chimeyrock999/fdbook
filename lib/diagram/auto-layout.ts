// Places the nodes a diagram has no position for, with ELK's layered layout
// (elkjs, EPL-2.0). A node with an entry in layout.nodes was placed by a
// person and never moves, unless `all` asks to lay out everything again.
//
// A new diagram is laid out whole, with its groups as ELK compound nodes so
// members stay together, left to right or top down, whichever validates
// better (a wide canvas shrinks its text below what reads on a desktop). A node added to a laid-out
// diagram goes where ELK would put it next to its placed neighbours (the
// offset ELK gives it from them, applied to where they really are), then
// steps to the nearest spot clear of other nodes and of frames it is not a
// member of.

import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js';
import { rectsOverlap, textUnits, type Rect } from './geometry.ts';
import { buildScene } from './scene.ts';
import { diagramSchema, type DiagramInput } from './schema.ts';
import { validateDiagram } from './validate.ts';

type Input = DiagramInput;
type Box = { x: number; y: number; w: number; h: number };

const MARGIN = 40;
const GRID = 10;
const NODE_GAP = 40;
// Wide enough for an edge label between two layers.
const LAYER_GAP = 100;
// Room inside a frame: the title rail on top, the default pad elsewhere
// (scene.ts DEFAULT_PAD and its title rail).
const FRAME_PAD = 30;
const FRAME_TOP = 44;
const FREE_GAP = 24;
// The desktop reading column a note fits its diagram to (geometry.ts).
const READING_WIDTH = 930;

const snap = (value: number) => Math.round(value / GRID) * GRID;

// A box that fits the label at the size scene.ts prefers, as the notes'
// diagrams size theirs.
export function defaultNodeSize(node: Input['nodes'][number]) {
  const text = Math.max(textUnits(node.label) * 6.6, textUnits(node.sublabel) * 9 * 0.6, textUnits(node.tag) * 7 * 0.6);
  return { w: Math.max(150, Math.ceil((text + 32) / GRID) * GRID), h: node.sublabel || node.tag ? 68 : 56 };
}

// Each node's and group's parent in the ELK tree: the innermost group that
// lists it. A node listed by two unrelated groups keeps the first.
function parents(diagram: Input) {
  const groups = diagram.groups ?? [];
  const groupIds = new Set(groups.map((group) => group.id));
  const parent = new Map<string, string>();
  for (const group of groups) {
    for (const member of group.members) if (groupIds.has(member) && !parent.has(member)) parent.set(member, group.id);
  }
  const depth = (id: string, seen = new Set<string>()): number => {
    const up = parent.get(id);
    if (!up || seen.has(up)) return 0;
    seen.add(up);
    return 1 + depth(up, seen);
  };
  const byDepth = [...groups].sort((a, b) => depth(b.id) - depth(a.id));
  for (const node of diagram.nodes) {
    const owner = byDepth.find((group) => group.members.includes(node.id));
    if (owner) parent.set(node.id, owner.id);
  }
  return parent;
}

// Absolute boxes for every node, from ELK.
async function elkBoxes(diagram: Input, sizes: Map<string, { w: number; h: number }>, direction: 'RIGHT' | 'DOWN', layerGap = LAYER_GAP) {
  const parent = parents(diagram);
  const elkNodes = new Map<string, ElkNode>();
  const root: ElkNode = {
    id: '__root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': String(NODE_GAP),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(layerGap),
      'elk.layered.spacing.edgeNodeBetweenLayers': String(NODE_GAP / 2),
    },
    children: [],
    edges: [],
  };
  for (const group of diagram.groups ?? []) {
    elkNodes.set(group.id, { id: group.id, children: [], layoutOptions: { 'elk.padding': `[top=${FRAME_TOP},left=${FRAME_PAD},bottom=${FRAME_PAD},right=${FRAME_PAD}]` } });
  }
  for (const node of diagram.nodes) {
    const size = sizes.get(node.id)!;
    elkNodes.set(node.id, { id: node.id, width: size.w, height: size.h });
  }
  for (const [id, elk] of elkNodes) {
    const up = parent.get(id);
    (up ? elkNodes.get(up)! : root).children!.push(elk);
  }
  // Groups without members (all of them groups that hold nothing) would be
  // empty boxes; ELK sizes them, nothing reads them.
  root.edges = (diagram.edges ?? [])
    .filter((edge) => elkNodes.has(edge.from) && elkNodes.has(edge.to))
    .map((edge): ElkExtendedEdge => ({ id: `e:${edge.id}`, sources: [edge.from], targets: [edge.to] }));
  const laid = await new ELK().layout(root);
  const boxes = new Map<string, Box>();
  const walk = (elk: ElkNode, dx: number, dy: number) => {
    for (const child of elk.children ?? []) {
      const x = dx + (child.x ?? 0);
      const y = dy + (child.y ?? 0);
      if (!child.children?.length && sizes.has(child.id)) boxes.set(child.id, { x, y, w: child.width ?? 0, h: child.height ?? 0 });
      walk(child, x, y);
    }
  };
  walk(laid, 0, 0);
  return boxes;
}

// The groups a node is in, through the groups that list other groups.
function memberships(diagram: Input) {
  const groups = diagram.groups ?? [];
  const result = new Map<string, Set<string>>();
  const expand = (groupId: string, seen = new Set<string>()): string[] => {
    if (seen.has(groupId)) return [];
    seen.add(groupId);
    const group = groups.find((candidate) => candidate.id === groupId);
    return group ? group.members.flatMap((member) => (groups.some((candidate) => candidate.id === member) ? expand(member, seen) : [member])) : [];
  };
  for (const group of groups) {
    for (const nodeId of expand(group.id)) {
      if (!result.has(nodeId)) result.set(nodeId, new Set());
      result.get(nodeId)!.add(group.id);
    }
  }
  return result;
}

const rectOf = (box: Box): Rect => ({ x: box.x, y: box.y, width: box.w, height: box.h });

// The frames the placed nodes draw, from the scene of the diagram cut down
// to them; the estimate below when that cut does not build.
function frameRects(diagram: Input, placed: Map<string, Box>) {
  const ids = new Set(placed.keys());
  const groups = structuredClone(diagram.groups ?? []);
  for (let changed = true; changed;) {
    changed = false;
    for (const group of groups) {
      const members = group.members.filter((member) => ids.has(member));
      if (members.length !== group.members.length) changed = true;
      group.members = members;
      if (members.length && !ids.has(group.id)) {
        ids.add(group.id);
        changed = true;
      }
    }
  }
  const cut = {
    ...diagram,
    nodes: diagram.nodes.filter((node) => placed.has(node.id)),
    groups: groups.filter((group) => group.members.length),
    edges: (diagram.edges ?? []).filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
    lanes: [],
    layout: { ...diagram.layout, nodes: Object.fromEntries(placed), lanes: undefined },
  };
  try {
    return buildScene(diagramSchema.parse(cut)).frames.map((frame) => ({ id: frame.group.id, rect: { x: frame.x, y: frame.y, width: frame.width, height: frame.height } }));
  } catch {
    return estimatedFrames(diagram, placed);
  }
}

function estimatedFrames(diagram: Input, placed: Map<string, Box>) {
  const inGroups = memberships(diagram);
  return (diagram.groups ?? []).flatMap((group) => {
    const members = [...placed].filter(([id]) => inGroups.get(id)?.has(group.id)).map(([, box]) => box);
    if (!members.length) return [];
    const x = Math.min(...members.map((box) => box.x)) - FRAME_PAD;
    const y = Math.min(...members.map((box) => box.y)) - FRAME_TOP;
    const right = Math.max(...members.map((box) => box.x + box.w)) + FRAME_PAD;
    const bottom = Math.max(...members.map((box) => box.y + box.h)) + FRAME_PAD;
    return [{ id: group.id, rect: { x, y, width: right - x, height: bottom - y } }];
  });
}

// The nearest free spot to `want`, on the grid, stepping outwards in rings.
// It stays within `maxRight`: a wider canvas would shrink every label once
// the note fits it to the reading column, while a taller one costs nothing.
function freeSpot(want: Box, nodeId: string, diagram: Input, placed: Map<string, Box>, maxRight: number) {
  const inGroups = memberships(diagram).get(nodeId) ?? new Set<string>();
  const frames = frameRects(diagram, placed).filter((frame) => !inGroups.has(frame.id));
  const fits = (box: Box) => box.x >= MARGIN / 2 && box.y >= MARGIN / 2 && box.x + box.w <= maxRight
    && [...placed.values()].every((other) => !rectsOverlap(rectOf(box), rectOf(other), FREE_GAP))
    && frames.every((frame) => !rectsOverlap(rectOf(box), frame.rect, FREE_GAP / 2));
  const start = { ...want, x: Math.min(snap(want.x), Math.max(MARGIN, snap(maxRight - want.w))), y: snap(want.y) };
  if (fits(start)) return start;
  for (let ring = 1; ring < 200; ring += 1) {
    const candidates: Box[] = [];
    for (let i = -ring; i <= ring; i += 1) {
      for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
        candidates.push({ ...start, x: start.x + dx * GRID * 2, y: start.y + dy * GRID * 2 });
      }
    }
    const best = candidates.filter(fits).sort((a, b) => Math.hypot(a.x - want.x, a.y - want.y) - Math.hypot(b.x - want.x, b.y - want.y))[0];
    if (best) return best;
  }
  return start;
}

export interface LayoutResult {
  diagram: Input;
  // The node ids given a position, in the order they were placed.
  placed: string[];
}

export async function layoutDiagram(diagram: Input, { all = false }: { all?: boolean } = {}): Promise<LayoutResult> {
  const next = structuredClone(diagram);
  const kept = new Map<string, Box>(all ? [] : Object.entries(next.layout.nodes).filter(([id]) => next.nodes.some((node) => node.id === id)));
  const missing = next.nodes.filter((node) => !kept.has(node.id));
  if (!missing.length) return { diagram: next, placed: [] };

  const sizes = new Map(next.nodes.map((node) => {
    const box = kept.get(node.id) ?? (all ? next.layout.nodes[node.id] : undefined);
    return [node.id, box ? { w: box.w, h: box.h } : defaultNodeSize(node)];
  }));
  if (!kept.size) {
    if (all) {
      delete next.layout.edges;
      delete next.layout.canvas;
    }
    let best: { diagram: Input; errors: number } | null = null;
    // Each direction, then each with more room between layers for labels.
    for (const [direction, layerGap] of [['RIGHT', LAYER_GAP], ['DOWN', LAYER_GAP], ['RIGHT', LAYER_GAP * 1.4], ['DOWN', LAYER_GAP * 1.4]] as const) {
      if (best?.errors === 0) break;
      const elk = await elkBoxes(next, sizes, direction, layerGap);
      const candidate = structuredClone(next);
      const minX = Math.min(...[...elk.values()].map((box) => box.x));
      const minY = Math.min(...[...elk.values()].map((box) => box.y));
      const offsetX = MARGIN + ((next.groups ?? []).length ? FRAME_PAD : 0) - minX;
      const offsetY = MARGIN + ((next.groups ?? []).length ? FRAME_TOP : 0) - minY;
      for (const node of next.nodes) {
        const box = elk.get(node.id)!;
        candidate.layout.nodes[node.id] = { x: snap(box.x + offsetX), y: snap(box.y + offsetY), w: box.w, h: box.h };
      }
      const errors = validateDiagram(candidate).issues.filter((issue) => issue.severity === 'error').length;
      if (!best || errors < best.errors) best = { diagram: candidate, errors };
    }
    return { diagram: best!.diagram, placed: next.nodes.map((node) => node.id) };
  }

  const elk = await elkBoxes(next, sizes, 'RIGHT');

  // Neighbours first: a node joined to a placed one has an anchor.
  const neighbours = (id: string) => (next.edges ?? []).flatMap((edge) => (edge.from === id ? [edge.to] : edge.to === id ? [edge.from] : []));
  const inGroups = memberships(next);
  const placed: string[] = [];
  // As wide as the canvas, or the drawing, or the reading column, whichever is widest.
  const contentRight = Math.max(...[...kept.values()].map((box) => box.x + box.w)) + MARGIN;
  const maxRight = Math.max(next.layout.canvas?.[0] ?? contentRight, contentRight, READING_WIDTH) - MARGIN / 2;
  const queue = [...missing];
  while (queue.length) {
    queue.sort((a, b) => Number(neighbours(b.id).some((id) => kept.has(id))) - Number(neighbours(a.id).some((id) => kept.has(id))));
    const node = queue.shift()!;
    const size = sizes.get(node.id)!;
    const own = elk.get(node.id)!;
    const anchors = [
      ...neighbours(node.id).filter((id) => kept.has(id) && elk.has(id)),
      ...[...kept.keys()].filter((id) => [...(inGroups.get(node.id) ?? [])].some((group) => inGroups.get(id)?.has(group)) && elk.has(id)),
    ];
    let want: Box;
    if (anchors.length) {
      const xs = anchors.map((id) => kept.get(id)!.x + (own.x - elk.get(id)!.x));
      const ys = anchors.map((id) => kept.get(id)!.y + (own.y - elk.get(id)!.y));
      want = { x: xs.reduce((a, b) => a + b) / xs.length, y: ys.reduce((a, b) => a + b) / ys.length, ...size };
    } else {
      // Unconnected: below everything placed, at the left margin.
      const bottom = Math.max(...[...kept.values()].map((box) => box.y + box.h));
      want = { x: MARGIN, y: bottom + LAYER_GAP / 2, ...size };
    }
    const box = freeSpot(want, node.id, next, kept, maxRight);
    kept.set(node.id, box);
    next.layout.nodes[node.id] = box;
    placed.push(node.id);
  }
  // A set canvas grows to hold what was added.
  if (next.layout.canvas) {
    const added = placed.map((id) => kept.get(id)!);
    const right = Math.max(...added.map((box) => box.x + box.w)) + MARGIN;
    const bottom = Math.max(...added.map((box) => box.y + box.h)) + MARGIN;
    const [width, height] = next.layout.canvas;
    if (right > width || bottom > height) next.layout.canvas = [Math.max(width, right), Math.max(height, bottom)];
  }
  return { diagram: next, placed };
}
