// Turns a diagram into the geometry it is drawn with: node boxes, group
// frames and their title rails, routed edges with placed labels, lanes, the
// legend and the canvas. The composition follows Archify's architecture
// renderer (MIT, renderers/architecture/render-architecture.mjs) under its
// showcase profile, so diagrams imported from it keep their look.

import {
  fittedNodeFontSize,
  labelPoint,
  minimumReadableSourceTextPx,
  rectsOverlap,
  segmentIntersectsRect,
  textUnits,
  type Box,
  type Frame,
  type Point,
  type Rect,
  type RouteEdge,
  type Segment,
} from './geometry.ts';
import { placeAutomaticLabels, reservedLabelRect, type LabelRect } from './labels.ts';
import { legendEntries, legendFootprint, placeLegend, type SceneLegend } from './legend.ts';
import { createRouter } from './router.ts';
import type { Diagram, DiagramEdge, DiagramGroup, DiagramKind, DiagramLane, DiagramNode, DiagramType } from '#model/schema.ts';
import { buildLifecycleScene, type LifecycleLayer } from './lifecycle.ts';
import { buildSequenceScene, type SequenceLayer } from './sequence.ts';

const MARGIN = 40;
const LEGEND_H = 28;
const DEFAULT_PAD = 30;
const BOUNDARY_EXTRA_BOTTOM = 20;
const TITLE_BASELINE = 18;
const TITLE_CLEARANCE = 4;
const TITLE_FONT_PREFERRED = 9;
const TITLE_FONT_MINIMUM = 6;
const TITLE_MASK_HEIGHT = 16;
const TITLE_RAIL_GAP = 2;
const TITLE_FRAME_INSET = 4;
const LABEL_HEIGHT = 14;
const DETAIL_LABEL_HEIGHT = 25;

export interface SceneNode extends Box {
  node: DiagramNode;
  kind: DiagramKind;
  labelFont: number;
  sublabelFont: number;
  tagFont: number;
  // The groups around the node, outermost first.
  context: string[];
  // Where the label, sublabel and tag sit, when not centred in the box: a
  // sequence's participant (no tag) or a lifecycle's state.
  text?: { label: number; sublabel: number; tag?: number; x?: number };
  // The corner glyph when not the kind's own (a lifecycle's final state).
  icon?: string;
}

export interface FrameTitle extends Rect {
  fontSize: number;
  baselineOffset: number;
}

export interface SceneFrame extends Frame {
  group: DiagramGroup;
  title: FrameTitle;
}

export interface SceneEdgeLabel extends Rect {
  lx: number;
  ly: number;
}

export interface SceneEdge {
  edge: DiagramEdge;
  points: Point[];
  d: string;
  strokeWidth: number;
  // A planned route gets a mask-coloured halo where it crosses another.
  automatic: boolean;
  label: SceneEdgeLabel | null;
}

export interface SceneLane extends Frame {
  lane: DiagramLane;
  header: { x: number; y: number; text: string; fontSize: number };
}

export interface Scene {
  type: DiagramType;
  diagram: Diagram;
  width: number;
  height: number;
  nodes: SceneNode[];
  frames: SceneFrame[];
  edges: SceneEdge[];
  lanes: SceneLane[];
  legend: SceneLegend | null;
  // The legend was asked for but does not fit its band.
  legendUnfit: boolean;
  // A sequence's lifelines, messages, segments and activations.
  sequence: SequenceLayer | null;
  // A lifecycle's composite frames, bus junctions, markers and labels.
  lifecycle: LifecycleLayer | null;
}

interface RawFrame extends Rect {
  group: DiagramGroup;
  memberTop: number;
}

// A group's node ids, through the groups it lists as members.
export function groupNodeIds(diagram: Diagram, group: DiagramGroup, seen = new Set<string>()): string[] {
  if (seen.has(group.id)) return [];
  seen.add(group.id);
  const nodeIds = new Set(diagram.nodes.map((node) => node.id));
  return [...new Set(group.members.flatMap((member) => {
    if (nodeIds.has(member)) return [member];
    const inner = diagram.groups.find((candidate) => candidate.id === member);
    return inner ? groupNodeIds(diagram, inner, seen) : [];
  }))];
}

const boxOf = (id: string, rect: Rect): Box => ({ id, ...rect, cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2 });
const titleWidth = (label: string, fontSize: number) => Math.max(30, textUnits(label) * fontSize * 0.6 + 10);
// Archify rounded a dashed (security) frame less; the router reads the radius too.
const frameRadius = (group: DiagramGroup) => (group.dashed ? 8 : 12);
const horizontalOverlap = (left: Rect, right: Rect) => left.x < right.x + right.width && left.x + left.width > right.x;

export function edgeLabelSize(edge: DiagramEdge) {
  const width = Math.max(30, textUnits(edge.label) * 4.8 + 10, edge.detail ? textUnits(edge.detail) * 4.2 + 10 : 0);
  return { width, height: edge.detail ? DETAIL_LABEL_HEIGHT : LABEL_HEIGHT };
}

export function buildScene(diagram: Diagram): Scene {
  if (diagram.type === 'sequence') return buildSequenceScene(diagram);
  if (diagram.type === 'lifecycle') return buildLifecycleScene(diagram);
  const { layout } = diagram;
  const nodes = new Map<string, Box>(diagram.nodes.map((node) => {
    const at = layout.nodes[node.id];
    return [node.id, boxOf(node.id, { x: at.x, y: at.y, width: at.w, height: at.h })];
  }));
  const nodeList = [...nodes.values()];

  // ---- Frames from their members, with room on top for the title rail.
  const topPad = (pad: number) => Math.max(pad, TITLE_BASELINE + TITLE_CLEARANCE, TITLE_MASK_HEIGHT + TITLE_CLEARANCE + TITLE_FRAME_INSET);
  const rawFrames: RawFrame[] = diagram.groups.flatMap((group) => {
    const members = groupNodeIds(diagram, group).map((id) => nodes.get(id)!);
    if (!members.length) return [];
    const minX = Math.min(...members.map((member) => member.x));
    const minY = Math.min(...members.map((member) => member.y));
    const maxX = Math.max(...members.map((member) => member.x + member.width));
    const maxY = Math.max(...members.map((member) => member.y + member.height));
    const pad = layout.groups?.[group.id]?.pad ?? DEFAULT_PAD;
    return [{
      group,
      x: minX - pad,
      y: minY - topPad(pad),
      width: maxX - minX + pad * 2,
      height: maxY - minY + topPad(pad) + BOUNDARY_EXTRA_BOTTOM,
      memberTop: minY,
    }];
  });
  const lanes = diagram.lanes.map((lane) => {
    const at = layout.lanes![lane.id];
    return { lane, x: at.x, y: at.y, width: at.w, height: at.h, radius: 10 };
  });

  // ---- Routing over nodes, the member-derived frames and the lanes.
  const edges: RouteEdge[] = diagram.edges.map((edge) => {
    const at = layout.edges?.[edge.id];
    return { id: edge.id, from: edge.from, to: edge.to, label: edge.label, variant: edge.variant, ...at };
  });
  const diagramEdge = new Map(edges.map((edge, index) => [edge, diagram.edges[index]]));
  const labelBoxAt = (edge: RouteEdge, [lx, ly]: Point, relationIndex: number): LabelRect => {
    const { width, height } = edgeLabelSize(diagramEdge.get(edge)!);
    const pinned = edge.labelAt !== undefined || edge.labelDx !== undefined || edge.labelDy !== undefined;
    return { x: lx - width / 2, y: ly - 10, width, height, lx, ly, relationIndex, pinned };
  };
  const groupBoxes = new Map(rawFrames.map((frame) => [frame.group.id, boxOf(frame.group.id, frame)]));
  const router = createRouter(nodes, edges, {
    frames: [...rawFrames.map((frame) => ({ ...frame, radius: frameRadius(frame.group) })), ...lanes],
    groupBoxes,
    // A single outward stub below the scene can remove a crossing without
    // widening the canvas; a fixed canvas keeps its bounds.
    readabilityBottomMargin: layout.canvas ? 0 : 24,
    labelRectFor: (edge, points, { routes, labels }) => (edge.label ? reservedLabelRect({
      label: labelBoxAt(edge, labelPoint(edge, points), -1),
      points,
      routes: routes.map((route, index) => ({ relationIndex: index, points: route })),
      labels,
      components: nodeList,
    }) : null),
  });
  const routed = edges.map((edge) => router.pathFor(edge));
  let labels: LabelRect[] = edges.flatMap((edge, index) => (edge.label ? [labelBoxAt(edge, labelPoint(edge, routed[index].points), index)] : []));
  const routeExtents = [
    ...labels,
    ...routed.flatMap(({ points }) => points.map(([x, y]) => ({ x, y, width: 0, height: 0 }))),
  ];

  // ---- Canvas: the authored one, or the content plus margins and legend.
  const entries = legendEntries(diagram);
  const autoCanvas = (frames: readonly Rect[]): [number, number] => {
    let maxX = 0;
    let maxY = 0;
    for (const rect of [...nodeList, ...frames, ...lanes, ...routeExtents]) {
      maxX = Math.max(maxX, rect.x + rect.width);
      maxY = Math.max(maxY, rect.y + rect.height);
    }
    let width = Math.ceil(maxX + MARGIN);
    let footprint = legendFootprint(entries, Math.max(1, width - MARGIN * 2));
    if (footprint.minWidth > width - MARGIN * 2) {
      width = Math.ceil(footprint.minWidth + MARGIN * 2);
      footprint = legendFootprint(entries, width - MARGIN * 2);
    }
    return [width, Math.ceil(maxY + MARGIN + LEGEND_H + footprint.extraHeight)];
  };
  const canvasWidth = (frames: readonly Rect[]) => layout.canvas?.[0] ?? autoCanvas(frames)[0];

  // ---- Frame titles: a pill on the frame's top rail, lifted above anything
  // it would cover, slid along the rail off any route, at a font the desktop
  // reading width keeps readable.
  const routeSegments: Segment[] = routed.flatMap(({ points }) => points.slice(1).map((end, index) => ({ start: points[index], end })));
  const slideTitleOffRoutes = (frame: Rect, title: FrameTitle, placedTitles: readonly Rect[]) => {
    const clear = (x: number) => {
      const rect = { ...title, x };
      return !routeSegments.some((segment) => segmentIntersectsRect(segment, rect, 2))
        && ![...placedTitles, ...nodeList, ...labels].some((other) => rectsOverlap(rect, other));
    };
    if (clear(title.x)) return;
    const left = frame.x + TITLE_FRAME_INSET;
    const right = frame.x + frame.width - TITLE_FRAME_INSET - title.width;
    const band = routeSegments.filter(({ start, end }) => Math.max(start[1], end[1]) >= title.y - 2 && Math.min(start[1], end[1]) <= title.y + title.height + 2);
    const labelBlockers = labels.filter((label) => label.y < title.y + title.height && label.y + label.height > title.y);
    const x = [
      right,
      ...band.flatMap(({ start, end }) => [Math.max(start[0], end[0]) + 8, Math.min(start[0], end[0]) - 8 - title.width]),
      ...labelBlockers.flatMap((label) => [label.x + label.width + 8, label.x - 8 - title.width]),
    ].filter((value) => value >= left && value <= right).sort((a, b) => a - b).find(clear);
    if (x !== undefined) title.x = x;
  };
  const layoutTitles = (minimumFontSize: number) => {
    const placedTitles: Rect[] = [];
    const measured = new Map<number, { frame: RawFrame; title: FrameTitle }>();
    const ordered = rawFrames.map((frame, index) => ({ frame, index }))
      .sort((left, right) => left.frame.width * left.frame.height - right.frame.width * right.frame.height || left.index - right.index);
    for (const { frame: raw, index } of ordered) {
      // A frame too narrow for its title at the readable size widens around it.
      const required = titleWidth(raw.group.label, minimumFontSize) + TITLE_FRAME_INSET * 2;
      const extra = Math.max(0, required - raw.width);
      const frame = extra ? { ...raw, x: raw.x - extra / 2, width: raw.width + extra } : raw;
      const availableWidth = Math.max(0, frame.width - TITLE_FRAME_INSET * 2);
      const units = textUnits(frame.group.label);
      const fitted = units > 0 ? (availableWidth - 10) / (units * 0.6) : TITLE_FONT_PREFERRED;
      const fontSize = Math.max(minimumFontSize, Math.min(Math.max(TITLE_FONT_PREFERRED, minimumFontSize), fitted));
      const height = Math.max(TITLE_MASK_HEIGHT, Math.ceil(fontSize + 7));
      const title: FrameTitle = {
        x: frame.x + TITLE_FRAME_INSET,
        y: frame.memberTop - TITLE_CLEARANCE - height,
        width: Math.min(availableWidth, titleWidth(frame.group.label, fontSize)),
        height,
        fontSize,
        baselineOffset: fontSize + 4,
      };
      for (let guard = 0; guard < rawFrames.length + nodeList.length + 1; guard += 1) {
        const blockers = [...placedTitles, ...nodeList].filter((candidate) => horizontalOverlap(title, candidate) && rectsOverlap(title, candidate));
        if (!blockers.length) break;
        title.y = blockers.reduce((min, blocker) => Math.min(min, blocker.y - TITLE_RAIL_GAP - title.height), Infinity);
      }
      slideTitleOffRoutes(frame, title, placedTitles);
      placedTitles.push(title);
      measured.set(index, { frame, title });
    }
    return rawFrames.map((_, index) => {
      const { frame, title } = measured.get(index)!;
      const bottom = frame.y + frame.height;
      const y = Math.min(frame.y, title.y - TITLE_FRAME_INSET);
      return { group: frame.group, x: frame.x, y, width: frame.width, height: bottom - y, radius: frameRadius(frame.group), title };
    });
  };
  // The canvas width sets the readable title size, and wider titles can
  // widen an automatic canvas: iterate until the size holds.
  let frames: SceneFrame[] = layoutTitles(TITLE_FONT_MINIMUM);
  if (rawFrames.length) {
    let candidate: readonly Rect[] = rawFrames;
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const minimumFontSize = Math.max(TITLE_FONT_MINIMUM, minimumReadableSourceTextPx(canvasWidth(candidate)) + 1e-6);
      frames = layoutTitles(minimumFontSize);
      if (minimumFontSize >= Math.max(TITLE_FONT_MINIMUM, minimumReadableSourceTextPx(canvasWidth(frames)))) break;
      candidate = frames;
    }
  }
  const [width, height] = layout.canvas ?? autoCanvas(frames);
  const legendBaseline = height - 16;

  // ---- Labels that collide move beside their route; the legend band stays free.
  labels = placeAutomaticLabels({
    keepFallbackNearRoute: true,
    labels,
    routes: routed.map(({ points }, relationIndex) => ({ relationIndex, points })),
    components: nodeList,
    titles: frames.map((frame) => frame.title),
    viewBox: [width, height],
    placementBottom: entries.length ? legendBaseline - 32 - legendFootprint(entries, width - MARGIN * 2).extraHeight : height,
  });
  const labelByIndex = new Map(labels.map((label) => [label.relationIndex, label]));

  const contentBottom = Math.max(0, ...[...nodeList, ...frames].map((rect) => rect.y + rect.height));
  const legend = placeLegend(entries, {
    x: MARGIN,
    baselineY: legendBaseline,
    width: width - MARGIN * 2,
    minTitleY: contentBottom + 8,
    obstacles: [...routeSegments, ...labels],
  });

  // Extra frame below the members, added last so nothing above shifts.
  for (const frame of frames) frame.height += layout.groups?.[frame.group.id]?.grow ?? 0;

  const contextOf = (id: string) => frames
    .filter((frame) => groupNodeIds(diagram, frame.group).includes(id))
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .map((frame) => frame.group.label);

  return {
    type: diagram.type,
    diagram,
    width,
    height,
    nodes: diagram.nodes.map((node) => {
      const box = nodes.get(node.id)!;
      return {
        ...box,
        node,
        kind: diagram.kinds.find((kind) => kind.id === node.kind)!,
        labelFont: fittedNodeFontSize(node.label, box.width, 11, 8),
        sublabelFont: node.sublabel ? fittedNodeFontSize(node.sublabel, box.width, 9, 6) : 9,
        tagFont: node.tag ? fittedNodeFontSize(node.tag, box.width, 7, 6) : 7,
        context: contextOf(node.id),
      };
    }),
    frames,
    edges: diagram.edges.map((edge, index) => {
      const label = labelByIndex.get(index);
      return {
        edge,
        points: routed[index].points,
        d: routed[index].d,
        strokeWidth: edge.variant === 'emphasis' ? 1.8 : 1.5,
        automatic: !edges[index].via,
        label: label ? { x: label.x, y: label.y, width: label.width, height: label.height, lx: label.lx, ly: label.ly } : null,
      };
    }),
    lanes: lanes.map((lane, index) => {
      const text = `${String(index + 1).padStart(2, '0')} / ${lane.lane.label}`;
      return { ...lane, header: { x: lane.x + lane.width / 2, y: lane.y + 22, text, fontSize: fittedNodeFontSize(text, lane.width, 9, 7) } };
    }),
    legend,
    legendUnfit: entries.length > 0 && legend === null,
    sequence: null,
    lifecycle: null,
  };
}
