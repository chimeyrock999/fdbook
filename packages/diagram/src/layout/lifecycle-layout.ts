// One pass of a lifecycle's layout at a given spacing: the main path as a
// row, lower rows of the other states, ports on each state side, tracks in
// the gaps between rows, every transition's route and its label. A port of
// Archify's renderers/lifecycle/render-lifecycle.mjs (MIT, LICENSE.archify:
// `layout` and the functions it calls), on the model lifecycle.ts builds.

import { rectsOverlap, segmentRectClearance, type Point, type Rect, type Segment } from './geometry.ts';
import type { DiagramEdge } from '#model/schema.ts';
import type { Bracket, LifeState, Model } from './lifecycle.ts';
import { assignTracks, type Run } from './lifecycle-tracks.ts';

export const STATE_H = 64;
export const MARGIN_X = 56;
const MARGIN_TOP = 28;
const PORT_PAD = 22;
const PORT_STEP = 26;
export const FRAME_PAD = 10;
const ARC_BASE = 30;
const ARC_STEP = 24;
const TRACK_STEP = 18;
const LABEL_GAP = 6;
const CLEARANCE = 5;

export type Spacing = {
  spineGap: number;
  rowGap: number;
  drop: number;
  firstTrack: number;
  ports: 'partner' | 'even';
}

export type LabelMode = 'above' | 'on' | 'beside' | 'none';

export type Route = {
  points: Point[];
  // The segment the label rides beside or on.
  segment: number;
  labelMode: LabelMode;
  bracket?: Bracket;
}

export type PlacedLabel = {
  cx: number;
  cy: number;
} & Rect

export type LayoutResult = {
  routes: Map<DiagramEdge, Route>;
  junctions: Point[];
  frames: Rect[];
  placedLabels: Map<DiagramEdge, PlacedLabel>;
  unplacedLabels: DiagramEdge[];
  contentBottom: number;
  contentRight: number;
}

type Connector =
  | { kind: 'single'; transition: DiagramEdge; down: boolean; upperId: string; lowerId: string; gap: number; order: number }
  | { kind: 'bracket'; bracket: Bracket; gap: number; order: number }
  | { kind: 'frame'; bracket: Bracket; frame: NonNullable<Bracket['frame']>; rect: Rect; lowerId: string; gap: number; order: number; exitX?: number }
  | { kind: 'loop'; transition: DiagramEdge; gap: number; order: number };

type PortKey = Connector | string;
type Port = { key: PortKey; otherX: number; order: number; x: number }
type Ports = Map<string, Map<PortKey, Port>>;

type Arc = { transition: DiagramEdge; key: string; lo: number; hi: number; index: number; level: number }

// A state of the model by id; every id a pass looks up names one.
export function stateOf(model: Pick<Model, 'states'>, id: string) {
  const each = model.states.get(id);
  if (!each) throw new Error(`No state has the id "${id}".`);
  return each;
}

// The ports already requested on one side of a state.
function sideOf(ports: Ports, id: string, side: string) {
  const slot = ports.get(`${id}|${side}`);
  if (!slot) throw new Error(`No port was requested on the ${side} of "${id}".`);
  return slot;
}

function portIn(ports: Ports, id: string, side: string, key: PortKey) {
  const port = sideOf(ports, id, side).get(key);
  if (!port) throw new Error(`No such port on the ${side} of "${id}".`);
  return port;
}

export function layout(model: Model, { spineGap, rowGap, drop, firstTrack, ports: portMode }: Spacing): LayoutResult {
  const { states, mainPath, transitions, rows, rowCount, depthOf, spineEdges, brackets, bracketOf } = model;
  const state = (id: string) => stateOf(model, id);
  const hasLabel = model.hasLabel;
  const labelBox = model.labelBox;
  const ofKind = (kind: string) => transitions.filter((transition) => model.kindOf.get(transition) === kind);

  // Main-path x positions: each gap fits its row label.
  let cursor = MARGIN_X;
  mainPath.forEach((id, index) => {
    const each = state(id);
    each.x = cursor;
    each.cx = cursor + each.width / 2;
    cursor += each.width + Math.max(spineGap, model.minimumSpineGaps[index] ?? 26);
  });
  for (let row = 1; row < rowCount; row += 1) placeRow(model, row, rowGap);

  // Shift horizontally so the leftmost element keeps the margin.
  const minX = Math.min(...[...states.values()].map((each) => each.x));
  const dx = MARGIN_X - minX;
  for (const each of states.values()) {
    each.x += dx;
    each.cx += dx;
  }

  const arcs = assignArcLevels(model);
  const maxLevel = Math.max(0, ...arcs.map((arc) => arc.level));
  const arcLabelReserve = arcs.some((arc) => hasLabel(arc.transition)) ? 12 : 0;
  const spineTop = MARGIN_TOP + (maxLevel ? ARC_BASE + (maxLevel - 1) * ARC_STEP + arcLabelReserve : 0);

  const ports: Ports = new Map();
  const portOf = (id: string, side: string, key: PortKey) => portIn(ports, id, side, key);
  const requestPort = (id: string, side: string, key: PortKey, otherX: number, order: number) => {
    const slot = `${id}|${side}`;
    const entries = ports.get(slot) ?? new Map<PortKey, Port>();
    ports.set(slot, entries);
    if (!entries.has(key)) entries.set(key, { key, otherX, order, x: 0 });
  };
  const cx = (id: string) => state(id).cx;

  // Connectors cross the gap below row `gap`: single transitions between two
  // rows, composite frame exits, shared buses, and loops between two
  // non-adjacent states of one row.
  const connectors: Connector[] = [];
  for (const transition of ofKind('between')) {
    if (bracketOf.has(transition)) continue;
    const down = depthOf(transition.from) < depthOf(transition.to);
    const upperId = down ? transition.from : transition.to;
    const lowerId = down ? transition.to : transition.from;
    connectors.push({ kind: 'single', transition, down, upperId, lowerId, gap: depthOf(upperId), order: transitions.indexOf(transition) });
  }
  const frames: Rect[] = [];
  for (const bracket of brackets.values()) {
    const order = transitions.indexOf(bracket.transitions[0]);
    if (!bracket.frame) {
      connectors.push({ kind: 'bracket', bracket, gap: 0, order });
      continue;
    }
    const first = state(mainPath[bracket.frame.lo]);
    const last = state(mainPath[bracket.frame.hi]);
    const rect = { x: first.x - FRAME_PAD, y: spineTop - FRAME_PAD, width: last.x + last.width - first.x + FRAME_PAD * 2, height: STATE_H + FRAME_PAD * 2 };
    frames.push(rect);
    for (const target of bracket.targets) connectors.push({ kind: 'frame', bracket, frame: bracket.frame, rect, lowerId: target, gap: 0, order });
  }
  // Neighbours in one lower row connect side to side; others loop underneath.
  const rowOrder = rows.map((list) => [...list].sort((a, b) => a.x - b.x).map((each) => each.id));
  const adjacent = (transition: DiagramEdge) => transition.from !== transition.to
    && Math.abs(rowOrder[depthOf(transition.from)].indexOf(transition.from) - rowOrder[depthOf(transition.from)].indexOf(transition.to)) === 1;
  const sides = ofKind('same').filter(adjacent);
  // Side labels ride on the line for groups of three or more. Reserve their
  // height before placing rows: gap growth cannot clear a label trapped
  // between two full-width parallel strokes.
  const sideGroups = new Map<string, DiagramEdge[]>();
  for (const transition of sides) {
    const key = [transition.from, transition.to].sort().join('\u0000');
    const group = sideGroups.get(key) ?? [];
    group.push(transition);
    sideGroups.set(key, group);
  }
  const sideLanes: { ordered: DiagramEdge[]; step: number }[] = [];
  const rowHeights = rows.map(() => STATE_H);
  for (const group of sideGroups.values()) {
    const rightward = (transition: DiagramEdge) => state(transition.from).x < state(transition.to).x;
    const ordered = [...group.filter(rightward), ...group.filter((transition) => !rightward(transition))];
    // More than five cannot spread apart on the shared edge; the checks say so.
    if (ordered.length > 5) model.crowded.add([ordered[0].from, ordered[0].to].join('\u0000'));
    let step = Math.min(20, 48 / (ordered.length - 1));
    if (ordered.length > 2) {
      const heights = ordered.map((transition) => (hasLabel(transition) ? labelBox(transition).height : 0));
      step = Math.max(step, ...heights.map((height) => (height ? height / 2 + CLEARANCE : 0)),
        ...heights.slice(1).map((height, index) => (height && heights[index] ? (height + heights[index]) / 2 + 4 : 0)));
      const row = depthOf(ordered[0].from);
      // Keep every side port eight pixels inside the rounded state corners.
      rowHeights[row] = Math.max(rowHeights[row], step * (ordered.length - 1) + 16);
    }
    sideLanes.push({ ordered, step });
  }
  for (const transition of ofKind('same').filter((transition) => !adjacent(transition))) {
    connectors.push({ kind: 'loop', transition, gap: depthOf(transition.from), order: transitions.indexOf(transition) });
  }

  for (const connector of connectors) {
    if (connector.kind === 'single') {
      requestPort(connector.upperId, 'bottom', connector, cx(connector.lowerId), connector.order);
      requestPort(connector.lowerId, 'top', connector, cx(connector.upperId), connector.order);
    } else if (connector.kind === 'frame') {
      requestPort(connector.lowerId, 'top', connector, connector.rect.x + connector.rect.width / 2, connector.order);
    } else if (connector.kind === 'loop') {
      const { from, to } = connector.transition;
      if (from === to) {
        requestPort(from, 'bottom', `${String(connector.order)}:out`, Infinity, 0);
        requestPort(from, 'bottom', `${String(connector.order)}:in`, Infinity, 1);
      } else {
        requestPort(from, 'bottom', `${String(connector.order)}:out`, cx(to), connector.order);
        requestPort(to, 'bottom', `${String(connector.order)}:in`, cx(from), connector.order);
      }
    } else {
      const { sources, targets } = connector.bracket;
      const dropCenter = targets.reduce((sum, id) => sum + cx(id), 0) / targets.length;
      const sourceCenter = sources.reduce((sum, id) => sum + cx(id), 0) / sources.length;
      for (const id of sources) requestPort(id, 'bottom', connector, dropCenter, connector.order);
      for (const id of targets) requestPort(id, 'top', connector, sourceCenter, connector.order);
    }
  }
  for (const arc of arcs) {
    const { transition } = arc;
    if (transition.from === transition.to) {
      requestPort(transition.from, 'top', `${arc.key}:out`, Infinity, 0);
      requestPort(transition.from, 'top', `${arc.key}:in`, Infinity, 1);
    } else {
      requestPort(transition.from, 'top', `${arc.key}:out`, cx(transition.to), 0);
      requestPort(transition.to, 'top', `${arc.key}:in`, cx(transition.from), 0);
    }
  }
  distributePorts(model, ports, arcs, portMode);
  placeFrameExits(model, connectors, ports, portOf);

  // Each gap assigns its horizontal runs to tracks, then the next row follows.
  const runs: Run<Connector>[] = connectors.map((connector) => {
    if (connector.kind === 'loop') {
      const { from, to } = connector.transition;
      const tops = [portOf(from, 'bottom', `${String(connector.order)}:out`).x, portOf(to, 'bottom', `${String(connector.order)}:in`).x];
      return { connector, tops, bottoms: [], lo: Math.min(...tops), hi: Math.max(...tops), straight: false };
    }
    if (connector.kind === 'bracket') {
      const { sources, targets } = connector.bracket;
      const tops = sources.map((id) => portOf(id, 'bottom', connector).x);
      const bottoms = targets.map((id) => portOf(id, 'top', connector).x);
      const xs = [...tops, ...bottoms];
      return { connector, tops, bottoms, lo: Math.min(...xs), hi: Math.max(...xs), straight: false };
    }
    let top: number;
    if (connector.kind === 'frame') {
      if (connector.exitX === undefined) throw new Error('placeFrameExits places every frame exit.');
      top = connector.exitX;
    } else {
      top = portOf(connector.upperId, 'bottom', connector).x;
    }
    const bottom = portOf(connector.lowerId, 'top', connector).x;
    return { connector, tops: [top], bottoms: [bottom], lo: Math.min(top, bottom), hi: Math.max(top, bottom), straight: Math.abs(top - bottom) < 0.5 };
  });
  const rowTop = [spineTop];
  const trackY: ((track: number) => number)[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    for (const each of rows[row]) {
      each.y = rowTop[row];
      each.height = rowHeights[row];
      each.cy = rowTop[row] + each.height / 2;
    }
    const bottom = rowTop[row] + rowHeights[row];
    const count = assignTracks(runs.filter((run) => run.connector.gap === row));
    trackY[row] = (track) => bottom + firstTrack + track * TRACK_STEP;
    if (row + 1 < rowCount) rowTop.push((count ? trackY[row](count - 1) : bottom + firstTrack) + drop);
  }
  const rowBottom = (row: number) => rowTop[row] + rowHeights[row];

  // Routes, keyed by transition.
  const routes = new Map<DiagramEdge, Route>();
  const junctions: Point[] = [];
  for (const [index, transition] of spineEdges) {
    const from = state(mainPath[index]);
    const to = state(mainPath[index + 1]);
    routes.set(transition, { points: [[from.x + from.width, from.cy], [to.x, to.cy]], segment: 0, labelMode: 'above' });
  }
  for (const arc of arcs) {
    const { transition } = arc;
    const out = portOf(transition.from, 'top', `${arc.key}:out`).x;
    const inn = portOf(transition.to, 'top', `${arc.key}:in`).x;
    const y = spineTop - ARC_BASE - (arc.level - 1) * ARC_STEP;
    routes.set(transition, { points: [[out, spineTop], [out, y], [inn, y], [inn, spineTop]], segment: 1, labelMode: 'on' });
  }
  for (const run of runs) {
    const { connector } = run;
    const { gap } = connector;
    const y = trackY[gap](run.track ?? 0);
    const upper = rowBottom(gap);
    const lower = rowTop[gap + 1];
    if (connector.kind === 'loop') {
      const [a, b] = run.tops;
      routes.set(connector.transition, { points: [[a, upper], [a, y], [b, y], [b, upper]], segment: 1, labelMode: 'on' });
      continue;
    }
    if (connector.kind === 'single' || connector.kind === 'frame') {
      const [top] = run.tops;
      const [bottom] = run.bottoms;
      const start = connector.kind === 'frame' ? connector.rect.y + connector.rect.height : upper;
      const down: Point[] = run.straight ? [[top, start], [top, lower]] : [[top, start], [top, y], [bottom, y], [bottom, lower]];
      if (connector.kind === 'single') {
        const points = connector.down ? down : [...down].reverse();
        routes.set(connector.transition, { points, segment: connector.down ? points.length - 2 : 0, labelMode: 'beside' });
      } else {
        connector.bracket.transitions.filter((transition) => transition.to === connector.lowerId)
          .forEach((transition, index) => routes.set(transition, {
            points: down, segment: down.length - 2, labelMode: index ? 'none' : 'beside', bracket: connector.bracket,
          }));
      }
      continue;
    }
    const { bracket } = connector;
    const labelled = new Set<string>();
    for (const transition of bracket.transitions) {
      const tick = portOf(transition.from, 'bottom', connector).x;
      const dropX = portOf(transition.to, 'top', connector).x;
      const points: Point[] = Math.abs(tick - dropX) < 0.5
        ? [[tick, upper], [tick, lower]]
        : [[tick, upper], [tick, y], [dropX, y], [dropX, lower]];
      const owner = !labelled.has(transition.to);
      labelled.add(transition.to);
      routes.set(transition, { points, segment: points.length - 2, labelMode: owner ? 'beside' : 'none', bracket });
    }
    for (const x of [...run.tops, ...run.bottoms]) {
      if (x > run.lo + 0.5 && x < run.hi - 0.5) junctions.push([x, y]);
    }
  }
  // Parallel transitions between two neighbours spread symmetrically around
  // the shared edge, left-to-right ones first; a reciprocal pair lands at ±10.
  for (const { ordered, step } of sideLanes) {
    ordered.forEach((transition, index) => {
      const from = state(transition.from);
      const to = state(transition.to);
      const y = from.cy + (index - (ordered.length - 1) / 2) * step;
      const points: Point[] = from.x < to.x ? [[from.x + from.width, y], [to.x, y]] : [[from.x, y], [to.x + to.width, y]];
      // With three or more parallels the inner strokes leave no lane for a
      // floating label, so their labels ride on the line like arc labels.
      routes.set(transition, { points, segment: 0, labelMode: ordered.length > 2 ? 'on' : 'above' });
    });
  }

  const stateRight = Math.max(...[...states.values()].map((each) => each.x + each.width));
  const placed = placeLabels(model, routes, stateRight);
  const boxes: Rect[] = [...states.values(), ...placed.placedLabels.values()];
  const contentBottom = Math.max(
    ...boxes.map((box) => box.y + box.height),
    ...[...routes.values()].flatMap((route) => route.points.map((point) => point[1])),
  );
  const contentRight = Math.max(...boxes.map((box) => box.x + box.width));
  return { routes, junctions, frames, contentBottom, contentRight, ...placed };
}

// A composite exit leaves the frame directly above its target when possible,
// clear of the inner phases' own connectors and of sibling exits.
function placeFrameExits(model: Model, connectors: Connector[], ports: Ports, portOf: (id: string, side: string, key: PortKey) => Port) {
  const frameConnectors = connectors.filter((connector): connector is Extract<Connector, { kind: 'frame' }> => connector.kind === 'frame');
  for (const connector of frameConnectors) {
    const { rect, frame } = connector;
    const inner = model.mainPath.slice(frame.lo, frame.hi + 1)
      .flatMap((id) => [...(ports.get(`${id}|bottom`)?.values() ?? [])].map((port) => port.x));
    const taken = [...inner, ...frameConnectors.flatMap((other) => (other.rect === rect && other.exitX !== undefined ? [other.exitX] : []))];
    const target = portOf(connector.lowerId, 'top', connector);
    const low = rect.x + 16;
    const high = rect.x + rect.width - 16;
    const wanted = Math.min(high, Math.max(low, target.x));
    const free = (x: number) => x >= low && x <= high && taken.every((other) => Math.abs(other - x) >= 14);
    let exitX = wanted;
    for (let step = 0; step <= 40 && !free(exitX); step += 1) {
      exitX = [wanted + step * 7, wanted - step * 7].find(free) ?? exitX;
    }
    connector.exitX = exitX;
    // Snap the target's port to the exit when that keeps its spacing.
    const delta = Math.abs(exitX - target.x);
    if (delta >= 0.5 && delta < 24) {
      const lower = stateOf(model, connector.lowerId);
      const others = [...sideOf(ports, connector.lowerId, 'top').values()].filter((port) => port !== target);
      if (exitX >= lower.x + 12 && exitX <= lower.x + lower.width - 12 && others.every((port) => Math.abs(port.x - exitX) >= 12)) {
        target.x = exitX;
      } else if (delta < 16) {
        connector.exitX = [target.x, exitX + Math.sign(exitX - target.x || 1) * (16 - delta)].find(free) ?? exitX;
      }
    }
  }
}

// Each lower row starts every state under the states it connects to in the
// row above; overlapping blocks merge and centre on their combined ideal.
function placeRow(model: Model, row: number, rowGap: number) {
  const { transitions, rows, depthOf, mainPath, brackets, bracketTargets } = model;
  const members = rows[row];
  const ideal = new Map<string, number>();
  for (const each of members) {
    const xs = transitions.flatMap((transition) => {
      const other = transition.to === each.id ? transition.from : transition.from === each.id ? transition.to : null;
      return other && depthOf(other) === row - 1 ? [stateOf(model, other).cx] : [];
    });
    if (xs.length) ideal.set(each.id, xs.reduce((sum, x) => sum + x, 0) / xs.length);
  }
  if (row === 1) {
    for (const bracket of brackets.values()) {
      const center = bracket.sources.reduce((sum, id) => sum + stateOf(model, id).cx, 0) / bracket.sources.length;
      bracket.targets.forEach((id) => ideal.set(id, center));
    }
  }
  const fallback = mainPath.length ? Math.max(...mainPath.map((id) => stateOf(model, id).cx)) + 1 : MARGIN_X;
  type Block = { members: LifeState[]; ideal: number; weight: number; order: number };
  const blocks: Block[] = [];
  const grouped = new Set<string>();
  for (const each of members) {
    if (grouped.has(each.id)) continue;
    const bracket = row === 1 ? bracketTargets.get(each.id) : null;
    const list = bracket ? bracket.targets.map((id) => stateOf(model, id)) : [each];
    list.forEach((member) => grouped.add(member.id));
    blocks.push({ members: list, ideal: ideal.get(each.id) ?? fallback, weight: ideal.has(each.id) ? list.length : 0.05, order: members.indexOf(each) });
  }
  // Neighbours joined by a labelled transition keep room for its label.
  const gapBetween = (left: LifeState, right: LifeState) => Math.max(rowGap, ...transitions
    .filter((transition) => model.hasLabel(transition) && ((transition.from === left.id && transition.to === right.id)
      || (transition.from === right.id && transition.to === left.id)))
    .map((transition) => model.labelBox(transition).width + 32));
  blocks.sort((a, b) => a.ideal - b.ideal || a.order - b.order);
  // Lays a cluster of blocks side by side; each block's centre offset, and
  // each member's left offset.
  const arrange = (list: Block[]) => {
    const centres: number[] = [];
    const members: [LifeState, number][] = [];
    let x = 0;
    let previous: LifeState | null = null;
    for (const block of list) {
      const start = x;
      for (const member of block.members) {
        if (previous) x += gapBetween(previous, member);
        members.push([member, x]);
        x += member.width;
        previous = member;
      }
      centres.push((start + x) / 2);
    }
    return { width: x, offsets: centres.map((offset) => offset - x / 2), members };
  };
  // A cluster's centre is the weighted mean of (ideal - offset) over its
  // blocks, which minimises their squared drift.
  const centre = (list: Block[]) => {
    const { width, offsets: blockOffsets } = arrange(list);
    const weight = list.reduce((sum, block) => sum + block.weight, 0);
    return { width, x: list.reduce((sum, block, index) => sum + block.weight * (block.ideal - blockOffsets[index]), 0) / weight };
  };
  const clusters: Block[][] = [];
  for (const block of blocks) {
    clusters.push([block]);
    while (clusters.length > 1) {
      const last = clusters[clusters.length - 1];
      const previous = clusters[clusters.length - 2];
      const a = centre(previous);
      const b = centre(last);
      if (a.x + a.width / 2 + gapBetween(previous[previous.length - 1].members[previous[previous.length - 1].members.length - 1], last[0].members[0]) <= b.x - b.width / 2) break;
      clusters.splice(-2, 2, [...previous, ...last]);
    }
  }
  for (const cluster of clusters) {
    const { x, width } = centre(cluster);
    for (const [member, offset] of arrange(cluster).members) {
      member.x = x - width / 2 + offset;
      member.cx = member.x + member.width / 2;
    }
  }
}

// Arcs nest by span: a shorter arc stays lower; overlapping spans never share a level.
function assignArcLevels(model: Model): Arc[] {
  const { transitions, spineIndex } = model;
  const arcs: Arc[] = transitions.filter((transition) => model.kindOf.get(transition) === 'arc').map((transition, index) => {
    const a = spineIndex.get(transition.from);
    const b = spineIndex.get(transition.to);
    if (a === undefined || b === undefined) throw new Error('An arc joins two main-path states.');
    return { transition, key: `arc${String(transitions.indexOf(transition))}`, lo: Math.min(a, b), hi: Math.max(a, b), index, level: 0 };
  });
  const sorted = [...arcs].sort((left, right) => (left.hi - left.lo) - (right.hi - right.lo) || left.lo - right.lo || left.index - right.index);
  for (const arc of sorted) {
    const blocking = sorted.filter((other) => other !== arc && other.level
      && ((other.lo < arc.hi && arc.lo < other.hi) || (other.lo === other.hi && arc.lo < other.lo && other.lo < arc.hi)
        || (other.lo === arc.lo && other.hi === arc.hi)));
    arc.level = 1 + Math.max(0, ...blocking.map((other) => other.level));
  }
  return arcs;
}

// Port order on one side avoids crossings: connections toward the left use
// the left part of the side, connections toward the right the right part.
// Nested arcs put the outer (higher) arc's port furthest out and spread
// evenly; every other port moves toward its partner so connectors drop straight.
function distributePorts(model: Model, ports: Ports, arcs: Arc[], mode: Spacing['ports']) {
  const onSpine = (id: string) => model.spineIndex.has(id);
  const arcLevel = new Map<PortKey, number>(arcs.flatMap((arc) => [[`${arc.key}:out`, arc.level], [`${arc.key}:in`, arc.level]]));
  // Lower-row tops follow the upper ports they connect to, so place them last.
  const lowerTop = (slot: string) => slot.endsWith('|top') && !onSpine(slot.split('|')[0]);
  const slots = [...ports].sort(([a], [b]) => Number(lowerTop(a)) - Number(lowerTop(b)));
  for (const [slot, entries] of slots) {
    const id = slot.split('|')[0];
    const owner = stateOf(model, id);
    const list = [...entries.values()];
    if (lowerTop(slot)) {
      for (const port of list) {
        const key = port.key;
        const upper = typeof key !== 'string' && key.kind === 'single' ? ports.get(`${key.upperId}|bottom`)?.get(key) : null;
        if (upper) port.otherX = upper.x;
      }
    }
    list.sort((left, right) => {
      const leftDirection = Math.sign(left.otherX - owner.cx);
      const rightDirection = Math.sign(right.otherX - owner.cx);
      if (leftDirection !== rightDirection) return leftDirection - rightDirection;
      const leftLevel = arcLevel.get(left.key);
      const rightLevel = arcLevel.get(right.key);
      if (leftLevel !== undefined && rightLevel !== undefined && leftLevel !== rightLevel) {
        // An outer arc's riser must stay outside every inner span it rises past.
        return leftDirection < 0 ? leftLevel - rightLevel : rightLevel - leftLevel;
      }
      return left.otherX - right.otherX || left.order - right.order;
    });
    const usable = owner.width - PORT_PAD * 2;
    const step = list.length > 1 ? Math.min(PORT_STEP, usable / (list.length - 1)) : 0;
    const xs = mode === 'even' || (onSpine(id) && slot.endsWith('|top'))
      ? list.map((_, index) => owner.cx - (step * (list.length - 1)) / 2 + index * step)
      : fitPorts(list.map((port) => port.otherX), step, owner.x + PORT_PAD, owner.x + owner.width - PORT_PAD);
    list.forEach((port, index) => { port.x = Math.round(xs[index] * 10) / 10; });
  }
  snapPorts(model, ports, mode);
}

// Ordered ports as close to their wanted x as the step and side allow: a pool
// of adjacent violators (isotonic regression on wanted - index * step).
function fitPorts(wanted: number[], step: number, low: number, high: number) {
  const n = wanted.length;
  const top = high - step * (n - 1);
  const clamp = (x: number) => Math.min(Math.max(x, low), Math.max(low, top));
  const pools: { sum: number; count: number }[] = [];
  wanted.forEach((x, index) => {
    pools.push({ sum: (Number.isFinite(x) ? x : x > 0 ? high : low) - index * step, count: 1 });
    while (pools.length > 1 && pools[pools.length - 2].sum / pools[pools.length - 2].count > pools[pools.length - 1].sum / pools[pools.length - 1].count) {
      const last = pools.pop();
      const previous = pools.at(-1);
      if (!last || !previous) break;
      previous.sum += last.sum;
      previous.count += last.count;
    }
  });
  return pools.flatMap((pool) => Array<number>(pool.count).fill(clamp(pool.sum / pool.count))).map((x, index) => x + index * step);
}

// A nearly vertical connector becomes exactly vertical when a port can move
// without crowding its neighbours; otherwise its jog widens to a readable run.
function snapPorts(model: Model, ports: Ports, mode: Spacing['ports']) {
  const fits = (id: string, side: string, moving: Port, x: number) => {
    const owner = stateOf(model, id);
    return x >= owner.x + PORT_PAD - 8 && x <= owner.x + owner.width - PORT_PAD + 8
      && [...sideOf(ports, id, side).values()].every((other) => other === moving || Math.abs(other.x - x) >= 12);
  };
  for (const [slot, entries] of ports) {
    if (!slot.endsWith('|top')) continue;
    const lowerId = slot.split('|')[0];
    if (model.spineIndex.has(lowerId)) continue;
    // Validate the final group, since neighbouring ports may move together.
    const group = [...entries.values()].sort((a, b) => a.x - b.x);
    const owner = stateOf(model, lowerId);
    const targets = group.map((port) => (typeof port.key !== 'string' && port.key.kind === 'single'
      ? ports.get(`${port.key.upperId}|bottom`)?.get(port.key)?.x : undefined));
    if (targets.every((x): x is number => x !== undefined) && targets.every((x, index) => Number.isFinite(x)
      && x >= owner.x + PORT_PAD - 8 && x <= owner.x + owner.width - PORT_PAD + 8
      && (index === 0 || x - targets[index - 1] >= 12))) {
      group.forEach((port, index) => { port.x = targets[index]; });
      continue;
    }
    for (const port of entries.values()) {
      const connector = port.key;
      if (typeof connector === 'string') continue;
      if (connector.kind === 'single') {
        const upperPort = portIn(ports, connector.upperId, 'bottom', connector);
        const delta = Math.abs(upperPort.x - port.x);
        if (delta < 0.5 || (delta >= 16 && mode === 'even')) continue;
        if (fits(lowerId, 'top', port, upperPort.x)) port.x = upperPort.x;
        else if (delta >= 16) continue;
        else if (fits(connector.upperId, 'bottom', upperPort, port.x)) upperPort.x = port.x;
        else {
          const away = Math.sign(port.x - upperPort.x) || 1;
          const pushed = [upperPort.x + away * 16, upperPort.x - away * 16].find((x) => fits(lowerId, 'top', port, x));
          if (pushed !== undefined) port.x = pushed;
        }
      } else if (connector.kind === 'bracket') {
        // A drop next to a tick would leave a micro run on the shared bus.
        const ticks = connector.bracket.sources.map((id) => portIn(ports, id, 'bottom', connector).x);
        const near = ticks.find((x) => Math.abs(x - port.x) >= 0.5 && Math.abs(x - port.x) < 16);
        if (near !== undefined && fits(lowerId, 'top', port, near)) port.x = near;
      }
    }
  }
}

// Labels sit beside the segment that enters the target (or leaves the lower
// row), above main-path arrows, and on arc and lower-loop runs. Every
// candidate keeps clear of other routes, states and labels.
function placeLabels(model: Model, routes: Map<DiagramEdge, Route>, contentRight: number) {
  const { transitions, states } = model;
  const placedLabels = new Map<DiagramEdge, PlacedLabel>();
  const unplacedLabels: DiagramEdge[] = [];
  const segmentsOf = (transition: DiagramEdge): Segment[] => {
    const points = routes.get(transition)?.points ?? [];
    return points.slice(1).map((end, index) => ({ start: points[index], end }));
  };
  // The transitions drawn as one exit with a transition, itself included.
  const siblingsOf = (transition: DiagramEdge) => {
    const bracket = routes.get(transition)?.bracket;
    return new Set(bracket ? bracket.transitions.filter((other) => other.to === transition.to) : [transition]);
  };
  for (const transition of transitions) {
    const route = routes.get(transition);
    if (!route || route.labelMode === 'none' || !model.hasLabel(transition)) continue;
    const { width, height } = model.labelBox(transition);
    const [start, end] = [route.points[route.segment], route.points[route.segment + 1]];
    const candidates: PlacedLabel[] = [];
    const at = (cx: number, cy: number): PlacedLabel => ({ x: cx - width / 2, y: cy - height / 2, width, height, cx, cy });
    if (route.labelMode === 'above') {
      const mid = (start[0] + end[0]) / 2;
      candidates.push(at(mid, start[1] - LABEL_GAP - height / 2), at(mid, start[1] + LABEL_GAP + height / 2));
    } else if (route.labelMode === 'on') {
      for (const fraction of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        candidates.push(at(start[0] + (end[0] - start[0]) * fraction, start[1]));
      }
    } else {
      const verticals = route.points.slice(1).map((point, index): [Point, Point] => [route.points[index], point])
        .filter(([a, b]) => Math.abs(a[0] - b[0]) < 0.5);
      const preferred: [Point, Point][] = [[start, end], ...verticals.filter(([a]) => a !== start)];
      const rowState = stateOf(model, model.depthOf(transition.to) < model.depthOf(transition.from) ? transition.from : transition.to);
      for (const [a, b] of preferred) {
        const x = a[0];
        const mid = (a[1] + b[1]) / 2;
        const sides = x <= rowState.cx ? [-1, 1] : [1, -1];
        for (const side of sides) {
          for (const shift of [0, -10, 10]) candidates.push(at(x + side * (LABEL_GAP + width / 2), mid + shift));
        }
      }
      const horizontal = route.points.slice(1).map((point, index): [Point, Point] => [route.points[index], point])
        .find(([a, b]) => Math.abs(a[1] - b[1]) < 0.5 && Math.abs(a[0] - b[0]) > width + 8);
      if (horizontal) candidates.push(at((horizontal[0][0] + horizontal[1][0]) / 2, horizontal[0][1]));
    }
    const own = siblingsOf(transition);
    const otherSegments = transitions.filter((other) => !own.has(other)).flatMap(segmentsOf);
    const ownSegments = [...own].flatMap(segmentsOf);
    const free = (rect: PlacedLabel) => rect.x >= 8 && rect.x + rect.width <= contentRight + MARGIN_X - 8 && rect.y >= 4
      && [...states.values()].every((each) => !rectsOverlap(rect, each, 4))
      && [...placedLabels.values()].every((other) => !rectsOverlap(rect, other, 4))
      && otherSegments.every((segment) => segmentRectClearance(segment, rect) >= CLEARANCE)
      && (route.labelMode === 'on' || ownSegments.every((segment) => segmentRectClearance(segment, rect) >= LABEL_GAP - 1));
    const chosen = candidates.find(free);
    if (chosen) placedLabels.set(transition, chosen);
    else {
      unplacedLabels.push(transition);
      placedLabels.set(transition, candidates[0]);
    }
  }
  return { placedLabels, unplacedLabels };
}
