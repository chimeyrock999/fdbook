// Lays a lifecycle (state) diagram out from its structure alone: the main
// path (`mainPath`) as one left-to-right row, transitions back to an earlier
// phase or skipping ahead as arcs above it, every other state in a row below
// at its distance from the main path, and an exit several phases share drawn
// once, from a dashed composite frame or a bus. The geometry is Archify's
// lifecycle renderer (MIT, renderers/lifecycle/render-lifecycle.mjs, schema
// v3); there are no routing or label controls. A state's look comes from its
// kind, the initial marker and the final state's double border from the
// structure. lifecycle-layout.ts holds one layout pass.

import { availableTextWidth, fittedNodeFontSize, minimumTextWidth, NODE_TEXT_PADDING, roundedPath, type Point, type Rect } from './geometry.ts';
import { legendFootprint, lifecycleLegendEntries, placeLegend } from './legend.ts';
import { layout, MARGIN_X, STATE_H, type LayoutResult, type Spacing } from './lifecycle-layout.ts';
import type { Scene, SceneEdge, SceneNode } from './scene.ts';
import type { Diagram, DiagramEdge, DiagramNode, EdgeVariant } from './schema.ts';

export const TEXT = { labelPreferred: 12, labelMinimum: 10, sublabelPreferred: 9, sublabelMinimum: 8, tagPreferred: 8, tagMinimum: 7 };
export const LABEL_FONT = 10;
export const NOTE_FONT = 9;
const STATE_MIN_W = 140;
export const STATE_MAX_W = 220;
export const CORNER = 12;
const SPACING_ROUNDS = 5;
// The corner sigil's rail (Archify's utils.mjs).
const SIGIL_FOOTPRINT = 6 + 11;

export interface LifeState extends Rect {
  id: string;
  node: DiagramNode;
  cx: number;
  cy: number;
}

export interface Bracket {
  key: string;
  sources: string[];
  targets: string[];
  transitions: DiagramEdge[];
  // Consecutive main-path phases: a composite frame around them.
  frame?: { lo: number; hi: number };
}

type Kind = 'spine' | 'arc' | 'same' | 'between';

// What one layout pass reads: the states it moves, how each transition is
// drawn, the rows, the shared exits.
export interface Model {
  states: Map<string, LifeState>;
  mainPath: string[];
  transitions: DiagramEdge[];
  spineIndex: Map<string, number>;
  spineEdges: Map<number, DiagramEdge>;
  rows: LifeState[][];
  rowCount: number;
  depthOf: (id: string) => number;
  kindOf: Map<DiagramEdge, Kind>;
  brackets: Map<string, Bracket>;
  bracketOf: Map<DiagramEdge, Bracket>;
  bracketTargets: Map<string, Bracket>;
  minimumSpineGaps: number[];
  hasLabel: (transition: DiagramEdge) => boolean;
  labelBox: (transition: DiagramEdge) => { width: number; height: number };
  // Pairs of neighbours with more than five transitions between them.
  crowded: Set<string>;
}

export interface LifecycleLayer {
  frames: Rect[];
  junctions: Point[];
  // Where the initial marker points: the first main-path state's left side.
  initial: Point | null;
  finals: Set<string>;
  labels: Map<string, { x: number; y: number; width: number; height: number; cx: number }>;
  // The transitions drawn as one exit with each (a frame's or a bus's), by id.
  shares: Map<string, string[]>;
  unplacedLabels: string[];
  crowded: [string, string][];
  // Past this width the smallest text reads too small at desktop width.
  readableWidth: number;
  smallestText: number;
}

const fonts = (node: DiagramNode, width: number) => ({
  label: fittedNodeFontSize(node.label, width, TEXT.labelPreferred, TEXT.labelMinimum),
  sublabel: fittedNodeFontSize(node.sublabel ?? '', width, TEXT.sublabelPreferred, TEXT.sublabelMinimum),
  tag: fittedNodeFontSize(node.tag ?? '', width, TEXT.tagPreferred, TEXT.tagMinimum),
});

// Wide enough for every row at its preferred size; the label also clears
// the corner sigil that shares its row.
function preferredWidth(node: DiagramNode) {
  const need = (text: string | undefined, font: number) => (text ? minimumTextWidth(text, font) + NODE_TEXT_PADDING + 36 : 0);
  const label = minimumTextWidth(node.label, TEXT.labelPreferred) + (SIGIL_FOOTPRINT + 2) + 4 + 4;
  return Math.ceil(Math.min(STATE_MAX_W, Math.max(STATE_MIN_W, label, need(node.sublabel, TEXT.sublabelPreferred), need(node.tag, TEXT.tagPreferred))));
}

// The label's x, and the rows' baselines, clear of the corner sigil
// (Archify's nodeLabelLayout, without the brand and source rails).
function textLayout(width: number, height: number, rows: { text: string; font: number; y: number }[]) {
  const labelWidth = minimumTextWidth(rows[0].text, rows[0].font);
  const left = SIGIL_FOOTPRINT + 2;
  const right = width - 4;
  const x = width / 2;
  if (x - labelWidth / 2 >= left && x + labelWidth / 2 <= right) return { x, ys: rows.map((row) => row.y) };
  if (labelWidth <= right - left) {
    return { x: Math.min(Math.floor((right - labelWidth / 2) * 10) / 10, Math.max(x, Math.ceil((left + labelWidth / 2) * 10) / 10)), ys: rows.map((row) => row.y) };
  }
  let bottom = SIGIL_FOOTPRINT;
  const ys = rows.map((row) => {
    const y = Math.max(row.y, Math.ceil((bottom + 2 + row.font * 1.2) * 10) / 10);
    bottom = y + row.font * 0.3;
    return y;
  });
  return { x, ys: bottom <= height - 2 ? ys : rows.map((row) => row.y) };
}

// A main-path transition with no variant of its own is the emphasised row.
export function variantOf(model: Pick<Model, 'kindOf'>, transition: DiagramEdge): EdgeVariant {
  return transition.variant === 'default' && model.kindOf.get(transition) === 'spine' ? 'emphasis' : transition.variant;
}

function buildModel(diagram: Diagram): Model {
  const transitions = diagram.edges;
  // A main path the checks refuse (an unknown or repeated state) still
  // draws, from the states it names once, so the editor can fix it.
  const known = new Set(diagram.nodes.map((node) => node.id));
  const mainPath = [...new Set(diagram.mainPath)].filter((id) => known.has(id));
  const states = new Map(diagram.nodes.map((node) => [node.id, { id: node.id, node, x: 0, y: 0, width: preferredWidth(node), height: STATE_H, cx: 0, cy: 0 }]));
  const spineIndex = new Map(mainPath.map((id, index) => [id, index]));
  const hasLabel = (transition: DiagramEdge) => Boolean(transition.label || transition.detail);
  const labelBox = (transition: DiagramEdge) => {
    const text = transition.label ?? '';
    const note = transition.detail ?? '';
    const width = Math.ceil(Math.max(text ? minimumTextWidth(text, LABEL_FONT) : 0, note ? minimumTextWidth(note, NOTE_FONT) : 0) + 12);
    return { width, height: text && note ? 28 : 16 };
  };

  // The first forward transition between consecutive main-path states is the
  // row itself; any other main-path pair is an arc above the row.
  const spineEdges = new Map<number, DiagramEdge>();
  for (const transition of transitions) {
    const from = spineIndex.get(transition.from);
    const to = spineIndex.get(transition.to);
    if (from !== undefined && to === from + 1 && !spineEdges.has(from)) spineEdges.set(from, transition);
  }
  const minimumSpineGaps = mainPath.slice(0, -1).map((_, index) => {
    const edge = spineEdges.get(index);
    return (edge && hasLabel(edge) ? labelBox(edge).width : 0) + 26;
  });

  // Every other state sits in a row below the main path at its distance
  // from it, so each transition stays within one row or joins two adjacent rows.
  const depth = new Map(mainPath.map((id) => [id, 0]));
  for (let frontier = [...mainPath]; frontier.length;) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const transition of transitions) {
        const other = transition.from === id ? transition.to : transition.to === id ? transition.from : null;
        if (other && states.has(other) && !depth.has(other)) {
          depth.set(other, depth.get(id)! + 1);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  for (const id of states.keys()) if (!depth.has(id)) depth.set(id, 1);
  const depthOf = (id: string) => depth.get(id)!;
  const rowCount = Math.max(...depth.values()) + 1;
  const rows = Array.from({ length: rowCount }, (_, row) => (row === 0
    ? mainPath.map((id) => states.get(id)!)
    : [...states.values()].filter((each) => depthOf(each.id) === row)));

  const kindOf = new Map<DiagramEdge, Kind>(transitions.map((transition) => {
    const [from, to] = [depthOf(transition.from), depthOf(transition.to)];
    if (from === 0 && to === 0) return [transition, spineEdges.get(spineIndex.get(transition.from)!) === transition ? 'spine' : 'arc'];
    return [transition, from === to ? 'same' : 'between'];
  }));
  const model = { kindOf };

  // Exits that leave several main-path phases for one state are drawn once:
  // from a composite frame around consecutive phases, or from a shared bus.
  // A merged exit promises one meaning, so only a target with exactly one
  // group of identical label, note and variant from two phases or more joins.
  const downByTarget = new Map<string, DiagramEdge[]>();
  for (const transition of transitions.filter((each) => kindOf.get(each) === 'between')) {
    if (depthOf(transition.from) !== 0) continue;
    if (!downByTarget.has(transition.to)) downByTarget.set(transition.to, []);
    downByTarget.get(transition.to)!.push(transition);
  }
  const signature = (transition: DiagramEdge) => [transition.label ?? '', transition.detail ?? '', variantOf(model, transition)].join('\u0000');
  const brackets = new Map<string, Bracket>();
  for (const [target, list] of downByTarget) {
    const buckets = new Map<string, DiagramEdge[]>();
    for (const transition of list) {
      const key = signature(transition);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(transition);
    }
    const eligible = [...buckets.values()].filter((bucket) => new Set(bucket.map((transition) => transition.from)).size >= 2);
    if (eligible.length !== 1) continue;
    const [group] = eligible;
    const sources = [...new Set(group.map((transition) => transition.from))].sort((a, b) => spineIndex.get(a)! - spineIndex.get(b)!);
    const key = sources.join('\u0000');
    if (!brackets.has(key)) brackets.set(key, { key, sources, targets: [], transitions: [] });
    brackets.get(key)!.targets.push(target);
    brackets.get(key)!.transitions.push(...group);
  }
  const bracketOf = new Map<DiagramEdge, Bracket>();
  for (const bracket of brackets.values()) for (const transition of bracket.transitions) bracketOf.set(transition, bracket);
  // Consecutive main-path phases form a composite state; frames never
  // partially overlap, and such a bracket keeps a shared bus.
  const frameSpans: { lo: number; hi: number }[] = [];
  for (const bracket of brackets.values()) {
    const indexes = bracket.sources.map((id) => spineIndex.get(id)!);
    const lo = Math.min(...indexes);
    const hi = Math.max(...indexes);
    if (hi - lo + 1 !== indexes.length || frameSpans.some((span) => span.lo <= hi && lo <= span.hi)) continue;
    bracket.frame = { lo, hi };
    frameSpans.push(bracket.frame);
  }
  const bracketTargets = new Map<string, Bracket>();
  for (const bracket of brackets.values()) for (const target of bracket.targets) bracketTargets.set(target, bracket);

  return {
    states, mainPath, transitions, spineIndex, spineEdges, rows, rowCount, depthOf, kindOf,
    brackets, bracketOf, bracketTargets, minimumSpineGaps, hasLabel, labelBox, crowded: new Set(),
  };
}

// Each round tries ports pulled toward their partners and ports spread
// evenly, and keeps the placed layout with the fewest bends and short jogs;
// a label left without a clear spot widens the spacing for the next round,
// up to five rounds, the main-path gaps only within the readable width.
function settle(model: Model, readableWidth: number): LayoutResult {
  const mainPathStateWidth = model.mainPath.reduce((sum, id) => sum + model.states.get(id)!.width, 0);
  let spacing = { spineGap: 72, rowGap: 44, drop: 58, firstTrack: 34 };
  let result: LayoutResult | null = null;
  // A pass moves the shared states; each candidate keeps where it put them.
  const states = [...model.states.values()];
  const snapshot = () => states.map(({ x, y, width, height, cx, cy }) => ({ x, y, width, height, cx, cy }));
  for (let round = 0; round < SPACING_ROUNDS; round += 1) {
    const candidates = (['partner', 'even'] as const).map((ports) => {
      const pass = layout(model, { ...spacing, ports } as Spacing);
      return { ...pass, boxes: snapshot() };
    });
    const placed = candidates.filter((candidate) => !candidate.unplacedLabels.length);
    const best = placed.sort((a, b) => routeCost(a.routes) - routeCost(b.routes))[0] ?? candidates[0];
    best.boxes.forEach((box, index) => Object.assign(states[index], box));
    result = best;
    if (placed.length) break;
    const nextSpineGap = spacing.spineGap + 28;
    const nextMainPathWidth = MARGIN_X * 2 + mainPathStateWidth
      + model.minimumSpineGaps.reduce((sum, minimum) => sum + Math.max(nextSpineGap, minimum), 0);
    spacing = {
      spineGap: nextMainPathWidth > readableWidth ? spacing.spineGap : nextSpineGap,
      rowGap: spacing.rowGap + 28, drop: spacing.drop + 14, firstTrack: spacing.firstTrack + 6,
    };
  }
  return result!;
}

function routeCost(routes: LayoutResult['routes']) {
  let cost = 0;
  for (const { points } of routes.values()) {
    cost += Math.max(0, points.length - 2) * 10;
    for (let index = 1; index < points.length; index += 1) {
      const run = Math.abs(points[index][0] - points[index - 1][0]);
      if (points.length > 2 && Math.abs(points[index][1] - points[index - 1][1]) < 0.5) cost += run * 0.1 + (run < 30 ? 40 : 0);
    }
  }
  return cost;
}

export function buildLifecycleScene(diagram: Diagram): Scene {
  const model = buildModel(diagram);
  const smallestText = Math.min(LABEL_FONT, ...[...model.states.values()].flatMap((each) => {
    const fitted = fonts(each.node, each.width);
    return [fitted.label, each.node.sublabel ? fitted.sublabel : Infinity];
  }));
  const readableWidth = Math.floor(930 * smallestText / 6);
  const geometry = settle(model, readableWidth);
  const outgoing = new Set(model.transitions.map((transition) => transition.from));
  const finals = new Set(diagram.nodes.filter((node) => !outgoing.has(node.id)).map((node) => node.id));

  const entries = lifecycleLegendEntries(diagram, finals.size > 0, model.mainPath[0]);
  const width = Math.max(640, Math.ceil(geometry.contentRight + MARGIN_X));
  const footprint = legendFootprint(entries, width - 80);
  const height = Math.ceil(geometry.contentBottom + (entries.length ? 78 + footprint.extraHeight : 32));
  const legend = placeLegend(entries, { x: 40, baselineY: height - 32, width: width - 80, minTitleY: geometry.contentBottom + 12, obstacles: [] });

  const nodes: SceneNode[] = diagram.nodes.map((node) => {
    const box = model.states.get(node.id)!;
    const fitted = fonts(node, box.width);
    const hasSub = Boolean(node.sublabel);
    // Baselines keep each row's whole glyph box apart.
    const [labelY, sublabelY, tagY] = hasSub && node.tag ? [23, 40, 55] : hasSub ? [27, 45, 0] : node.tag ? [29, 0, 50] : [37, 0, 0];
    const offset = (box.height - STATE_H) / 2;
    const rows = [{ text: node.label, font: fitted.label, y: labelY + offset }];
    if (hasSub) rows.push({ text: node.sublabel!, font: fitted.sublabel, y: sublabelY + offset });
    if (node.tag) rows.push({ text: node.tag, font: fitted.tag, y: tagY + offset });
    const text = textLayout(box.width, box.height, rows);
    return {
      id: node.id, x: box.x, y: box.y, width: box.width, height: box.height, cx: box.cx, cy: box.cy,
      node,
      kind: diagram.kinds.find((kind) => kind.id === node.kind)!,
      labelFont: fitted.label,
      sublabelFont: fitted.sublabel,
      tagFont: fitted.tag,
      context: [],
      text: { label: box.y + text.ys[0], sublabel: box.y + (text.ys[1] ?? 0), tag: node.tag ? box.y + text.ys[hasSub ? 2 : 1] : undefined, x: box.x + text.x },
      // Ordinary states carry no corner sigil unless their kind names one;
      // one that ends the lifecycle is an outcome and gets the stop sigil.
      icon: diagram.kinds.find((kind) => kind.id === node.kind)?.icon ?? (finals.has(node.id) ? 'stop' : 'none'),
    };
  });

  const edges: SceneEdge[] = diagram.edges.map((edge) => {
    const route = geometry.routes.get(edge);
    const points = route?.points ?? [];
    const label = geometry.placedLabels.get(edge);
    const variant = variantOf(model, edge);
    return {
      edge: variant === edge.variant ? edge : { ...edge, variant },
      points,
      d: roundedPath(points, CORNER),
      strokeWidth: variant === 'emphasis' ? 1.8 : 1.2,
      automatic: true,
      label: label ? { x: label.x, y: label.y, width: label.width, height: label.height, lx: label.cx, ly: label.y + (edge.label ? 11.5 : 11) } : null,
    };
  });

  const first = model.mainPath.length ? model.states.get(model.mainPath[0]) : undefined;
  return {
    type: 'lifecycle',
    diagram,
    width,
    height,
    nodes,
    frames: [],
    edges,
    lanes: [],
    legend,
    legendUnfit: entries.length > 0 && legend === null,
    sequence: null,
    lifecycle: {
      frames: geometry.frames,
      junctions: geometry.junctions,
      initial: first ? [first.x, first.cy] : null,
      finals,
      labels: new Map([...geometry.placedLabels].map(([edge, rect]) => [edge.id, rect])),
      shares: new Map([...model.bracketOf].map(([edge, bracket]) => [edge.id, bracket.transitions.filter((other) => other !== edge && other.to === edge.to).map((other) => other.id)])),
      unplacedLabels: geometry.unplacedLabels.map((edge) => edge.id),
      crowded: [...model.crowded].map((key) => key.split('\u0000') as [string, string]),
      readableWidth,
      smallestText,
    },
  };
}

// Whether a state's text fits Archify's widest state at its legible minimum.
export const stateTextFits = (text: string, minimum: number) => minimumTextWidth(text, minimum) <= availableTextWidth(STATE_MAX_W);
