// Geometry primitives ported from Archify (MIT, github.com/tt-a1i/archify,
// renderers/shared/geometry.mjs and utils.mjs). The routing and label
// placement built on them depend on their exact thresholds, so the
// constants and comparisons are kept as they are there. Its licence is in
// LICENSE.archify at the package root.

import type { Side } from '#model/schema.ts';

export type Point = [number, number];
export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
}
// A measured node: its rect plus its id and centre.
export type Box = {
  id: string;
  cx: number;
  cy: number;
} & Rect
export type Segment = {
  start: Point;
  end: Point;
}

const NUMERIC_CLEARANCE_PX = 0.0001;

export function isFinitePoint(...coords: number[]) {
  return coords.every((c) => Number.isFinite(c));
}

export function rectsOverlap(a: Rect, b: Rect, gap = 0) {
  // Non-finite geometry means "unknown", not "overlapping".
  if (!isFinitePoint(a.x, a.y, a.width, a.height, b.x, b.y, b.width, b.height)) return false;
  return !(
    a.x + a.width + gap <= b.x + NUMERIC_CLEARANCE_PX
    || b.x + b.width + gap <= a.x + NUMERIC_CLEARANCE_PX
    || a.y + a.height + gap <= b.y + NUMERIC_CLEARANCE_PX
    || b.y + b.height + gap <= a.y + NUMERIC_CLEARANCE_PX
  );
}

type Corners = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function pointInBox(point: Point, box: Corners) {
  return point[0] >= box.x1 && point[0] <= box.x2 && point[1] >= box.y1 && point[1] <= box.y2;
}

function orientation(a: Point, b: Point, c: Point) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < 0.0001) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a: Point, b: Point, c: Point) {
  return b[0] <= Math.max(a[0], c[0]) && b[0] >= Math.min(a[0], c[0])
    && b[1] <= Math.max(a[1], c[1]) && b[1] >= Math.min(a[1], c[1]);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return o1 !== o2 && o3 !== o4;
}

export function segmentIntersectsRect(segment: Segment, rect: Rect, gap = 0) {
  const box = { x1: rect.x - gap, y1: rect.y - gap, x2: rect.x + rect.width + gap, y2: rect.y + rect.height + gap };
  const [a, b] = [segment.start, segment.end];
  if (pointInBox(a, box) || pointInBox(b, box)) return true;
  return segmentsIntersect(a, b, [box.x1, box.y1], [box.x2, box.y1])
    || segmentsIntersect(a, b, [box.x2, box.y1], [box.x2, box.y2])
    || segmentsIntersect(a, b, [box.x2, box.y2], [box.x1, box.y2])
    || segmentsIntersect(a, b, [box.x1, box.y2], [box.x1, box.y1]);
}

function pointRectDistance(point: Point, rect: Rect) {
  const dx = Math.max(rect.x - point[0], 0, point[0] - (rect.x + rect.width));
  const dy = Math.max(rect.y - point[1], 0, point[1] - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

function pointSegmentDistanceXY(px: number, py: number, start: Point, end: Point) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.0000001) return Math.hypot(px - start[0], py - start[1]);
  const t = Math.max(0, Math.min(1, ((px - start[0]) * dx + (py - start[1]) * dy) / lengthSquared));
  return Math.hypot(px - (start[0] + t * dx), py - (start[1] + t * dy));
}

export function segmentRectClearance({ start, end }: Segment, rect: Rect) {
  if (segmentIntersectsRect({ start, end }, rect)) return 0;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  let clearance = Math.min(pointRectDistance(start, rect), pointRectDistance(end, rect));
  const corners = [rect.x, rect.y, right, rect.y, right, bottom, rect.x, bottom];
  for (let index = 0; index < 8; index += 2) {
    const distance = pointSegmentDistanceXY(corners[index], corners[index + 1], start, end);
    if (distance < clearance) clearance = distance;
  }
  return clearance;
}

// The clearance, or Infinity once the bounding boxes are farther apart than `limit`.
export function segmentRectClearanceWithin(segment: Segment, rect: Rect, limit: number) {
  const { start, end } = segment;
  if (segmentIntersectsRect(segment, rect)) return 0;
  const gapX = Math.max(rect.x - Math.max(start[0], end[0]), Math.min(start[0], end[0]) - (rect.x + rect.width));
  const gapY = Math.max(rect.y - Math.max(start[1], end[1]), Math.min(start[1], end[1]) - (rect.y + rect.height));
  if (Math.max(gapX, gapY) > limit) return Number.POSITIVE_INFINITY;
  return segmentRectClearance(segment, rect);
}

function crossProduct(a: Point, b: Point, c: Point) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function collinearForward(a: Point, b: Point, c: Point) {
  if (Math.abs(crossProduct(a, b, c)) > 0.0001) return false;
  return (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) >= -0.0001;
}

const NORMALIZED_ROUTE_POINTS = new WeakMap<readonly Point[], Point[]>();

// Drops repeated points and the middle of straight runs; cached per array.
export function normalizeRoutePoints(points: readonly Point[]): Point[] {
  const cached = NORMALIZED_ROUTE_POINTS.get(points);
  if (cached) return cached;
  const normalized: Point[] = [];
  for (const point of points) {
    if (!isFinitePoint(point[0], point[1])) continue;
    const previous = normalized.at(-1);
    if (previous && Math.abs(point[0] - previous[0]) <= 0.0001 && Math.abs(point[1] - previous[1]) <= 0.0001) continue;
    while (normalized.length >= 2 && collinearForward(normalized[normalized.length - 2], normalized[normalized.length - 1], point)) normalized.pop();
    normalized.push(point);
  }
  Object.freeze(normalized);
  NORMALIZED_ROUTE_POINTS.set(points, normalized);
  return normalized;
}

export function properSegmentIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const abC = crossProduct(a, b, c);
  const abD = crossProduct(a, b, d);
  const cdA = crossProduct(c, d, a);
  const cdB = crossProduct(c, d, b);
  const epsilon = 0.0001;
  const opposite = (left: number, right: number) => (left > epsilon && right < -epsilon) || (left < -epsilon && right > epsilon);
  if (!opposite(abC, abD) || !opposite(cdA, cdB)) return null;
  const denominator = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
  if (Math.abs(denominator) < epsilon) return null;
  const ab = a[0] * b[1] - a[1] * b[0];
  const cd = c[0] * d[1] - c[1] * d[0];
  return [
    (ab * (c[0] - d[0]) - (a[0] - b[0]) * cd) / denominator,
    (ab * (c[1] - d[1]) - (a[1] - b[1]) * cd) / denominator,
  ];
}

const ENDPOINT_SIDE_RULES: Record<Side, { horizontal: boolean; sourceSign: number; targetSign: number }> = {
  left: { horizontal: true, sourceSign: -1, targetSign: 1 },
  right: { horizontal: true, sourceSign: 1, targetSign: -1 },
  top: { horizontal: false, sourceSign: -1, targetSign: 1 },
  bottom: { horizontal: false, sourceSign: 1, targetSign: -1 },
};

// Whether the end segment leaves (or reaches) the node straight out of `side`.
function endpointHonorsSide(points: readonly Point[], endpoint: 'source' | 'target', side: Side) {
  const rule = ENDPOINT_SIDE_RULES[side];
  const normalized = normalizeRoutePoints(points);
  if (normalized.length < 2) return true;
  const segmentIndex = endpoint === 'source' ? 0 : normalized.length - 2;
  const start = normalized[segmentIndex];
  const end = normalized[segmentIndex + 1];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const along = rule.horizontal ? dx : dy;
  const across = rule.horizontal ? dy : dx;
  const expectedSign = endpoint === 'source' ? rule.sourceSign : rule.targetSign;
  return Math.abs(across) <= 0.0001 && along * expectedSign > 0.0001;
}

export function routeHonorsEndpointSides(points: readonly Point[], fromSide: Side, toSide: Side) {
  return endpointHonorsSide(points, 'source', fromSide) && endpointHonorsSide(points, 'target', toSide);
}

export function anchor(rect: Box, side: Side): Point {
  switch (side) {
    case 'left': return [rect.x, rect.cy];
    case 'right': return [rect.x + rect.width, rect.cy];
    case 'top': return [rect.cx, rect.y];
    case 'bottom': return [rect.cx, rect.y + rect.height];
  }
}

export function portHasCornerClearance(rect: Rect, side: Side, point: Point) {
  if (side === 'left' || side === 'right') {
    const inset = Math.min(16, rect.height / 2);
    return point[1] >= rect.y + inset && point[1] <= rect.y + rect.height - inset;
  }
  const inset = Math.min(16, rect.width / 2);
  return point[0] >= rect.x + inset && point[0] <= rect.x + rect.width - inset;
}

export function defaultFromSide(from: Box, to: Box): Side {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  if (dx !== 0 && Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy > 0 ? 'bottom' : 'top';
}

export function defaultToSide(from: Box, to: Box): Side {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  if (dx !== 0 && Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'right' : 'left';
  return dy > 0 ? 'top' : 'bottom';
}

// The fields of an edge the router reads: its ends and the placement the
// author pinned (sides, waypoints, label position).
export type RouteEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  variant: string;
  fromSide?: Side;
  toSide?: Side;
  via?: Point[];
  labelAt?: Point;
  labelDx?: number;
  labelDy?: number;
}

export function hasAuthoredRouteGeometry(edge: RouteEdge) {
  return Boolean(edge.via);
}

export function alignAutomaticFacingPorts(
  edge: RouteEdge, from: Box, to: Box, start: Point, end: Point, fromSide: Side, toSide: Side,
  ports: { from: boolean; to: boolean }, accept: (points: Point[]) => boolean,
): { start: Point; end: Point } {
  const horizontallyFacing = (fromSide === 'right' && toSide === 'left') || (fromSide === 'left' && toSide === 'right');
  const verticallyFacing = (fromSide === 'bottom' && toSide === 'top') || (fromSide === 'top' && toSide === 'bottom');
  if (hasAuthoredRouteGeometry(edge) || edge.labelAt || (!horizontallyFacing && !verticallyFacing)) return { start, end };
  if (ports.from && ports.to) return { start, end };
  if (!ports.from && !ports.to && (edge.fromSide || edge.toSide)) return { start, end };
  const alignmentDelta = horizontallyFacing ? Math.abs(start[1] - end[1]) : Math.abs(start[0] - end[0]);
  if (alignmentDelta >= 16) return { start, end };

  // Keep the shared endpoint's distinct spread slot and move only the
  // relationship's unshared endpoint onto that axis.
  const alignEndToStart = horizontallyFacing
    ? { start, end: [end[0], start[1]] as Point }
    : { start, end: [start[0], end[1]] as Point };
  const alignStartToEnd = horizontallyFacing
    ? { start: [start[0], end[1]] as Point, end }
    : { start: [end[0], start[1]] as Point, end };
  const candidates = ports.from ? [alignEndToStart] : ports.to ? [alignStartToEnd] : [alignEndToStart, alignStartToEnd];
  for (const candidate of candidates) {
    const points: Point[] = [candidate.start, candidate.end];
    if (portHasCornerClearance(from, fromSide, candidate.start)
      && portHasCornerClearance(to, toSide, candidate.end)
      && routeHonorsEndpointSides(points, fromSide, toSide)
      && accept(points)) return candidate;
  }
  return { start, end };
}

export const OUTWARD: Record<Side, Point> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

export type RhythmIssue = {
  segmentIndex: number;
  length: number;
}

// Segments too short to read: any under `microSegmentPx`, an interior one
// under `interiorSegmentPx`.
export function collectRouteRhythmIssues(points: readonly Point[], interiorSegmentPx = 16, microSegmentPx = 8): RhythmIssue[] {
  const issues: RhythmIssue[] = [];
  const normalized = normalizeRoutePoints(points);
  for (let segmentIndex = 0; segmentIndex < normalized.length - 1; segmentIndex += 1) {
    const start = normalized[segmentIndex];
    const end = normalized[segmentIndex + 1];
    const length = Math.abs(end[0] - start[0]) + Math.abs(end[1] - start[1]);
    if (length <= 0.0001) continue;
    const interior = segmentIndex > 0 && segmentIndex < normalized.length - 2;
    if (length < microSegmentPx - 0.0001 || (interior && length < interiorSegmentPx - 0.0001)) {
      issues.push({ segmentIndex, length });
    }
  }
  return issues;
}

export function automaticPortRhythmBridge(
  start: Point, end: Point, fromSide: Side, toSide: Side, accept: (points: Point[]) => boolean,
  endpointStubPx = 24, interiorSegmentPx = 16,
): Point[] | null {
  const fromVector = OUTWARD[fromSide];
  const toVector = OUTWARD[toSide];
  const opposedFacingGap = (
    (fromSide === 'right' && toSide === 'left' && end[0] > start[0])
    || (fromSide === 'left' && toSide === 'right' && start[0] > end[0])
  ) ? Math.abs(end[0] - start[0]) : (
    (fromSide === 'bottom' && toSide === 'top' && end[1] > start[1])
    || (fromSide === 'top' && toSide === 'bottom' && start[1] > end[1])
  ) ? Math.abs(end[1] - start[1]) : null;
  const boundedStubPx = opposedFacingGap != null && opposedFacingGap - endpointStubPx * 2 < interiorSegmentPx
    ? Math.max(8, Math.min(endpointStubPx, (opposedFacingGap - interiorSegmentPx) / 2))
    : null;
  const stubDistances = [endpointStubPx];
  if (boundedStubPx != null && boundedStubPx >= 8 && boundedStubPx !== endpointStubPx) stubDistances.push(boundedStubPx);
  const candidates: Point[][] = [];
  const vertical = (side: Side) => side === 'top' || side === 'bottom';

  for (const stubPx of stubDistances) {
    const startStub: Point = [start[0] + fromVector[0] * stubPx, start[1] + fromVector[1] * stubPx];
    const endStub: Point = [end[0] + toVector[0] * stubPx, end[1] + toVector[1] * stubPx];
    if (vertical(fromSide) && vertical(toSide) && Math.abs(start[0] - end[0]) < interiorSegmentPx) {
      for (const channelX of [Math.max(start[0], end[0]) + interiorSegmentPx, Math.min(start[0], end[0]) - interiorSegmentPx]) {
        candidates.push([start, startStub, [channelX, startStub[1]], [channelX, endStub[1]], endStub, end]);
      }
    }
    if (!vertical(fromSide) && !vertical(toSide) && Math.abs(start[1] - end[1]) < interiorSegmentPx) {
      for (const channelY of [Math.max(start[1], end[1]) + interiorSegmentPx, Math.min(start[1], end[1]) - interiorSegmentPx]) {
        candidates.push([start, startStub, [startStub[0], channelY], [endStub[0], channelY], endStub, end]);
      }
    }
  }
  return candidates
    .map((points) => normalizeRoutePoints(points))
    .find((points) => routeHonorsEndpointSides(points, fromSide, toSide)
      && collectRouteRhythmIssues(points, interiorSegmentPx).length === 0
      && accept(points)) ?? null;
}

export function chosenSide(side: Side | undefined, fallback: Side): Side {
  return side ?? fallback;
}

// Spreads the ends that share a node side so their arrows do not land on one point.
export function automaticPortSpread(
  edges: readonly RouteEdge[], boxes: ReadonlyMap<string, Box>,
  { gutter = 16, maxSpacing = 14, sideFor, spacingFor }: {
    gutter?: number;
    maxSpacing?: number;
    sideFor?: (edge: RouteEdge, endpoint: 'source' | 'target') => Side | undefined;
    spacingFor?: (left: RouteEdge, right: RouteEdge) => number;
  } = {},
) {
  type Item = { edge: RouteEdge; endpoint: 'from' | 'to'; rect: Box; side: Side; counterpart: Box }
  const groups = new Map<string, Item[]>();
  const spread = new Map<RouteEdge, { from?: Point; to?: Point }>();
  const add = (item: Item) => {
    const key = `${item.rect.id}\u0000${item.side}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  };

  for (const edge of edges) {
    if (edge.via || edge.labelAt) continue;
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    if (!from || !to) continue;
    const fromSide = chosenSide(edge.fromSide, sideFor?.(edge, 'source') ?? defaultFromSide(from, to));
    const toSide = chosenSide(edge.toSide, sideFor?.(edge, 'target') ?? defaultToSide(from, to));
    add({ edge, endpoint: 'from', rect: from, side: fromSide, counterpart: to });
    add({ edge, endpoint: 'to', rect: to, side: toSide, counterpart: from });
  }

  for (const items of groups.values()) {
    if (items.length < 2) continue;
    const verticalSide = items[0].side === 'left' || items[0].side === 'right';
    items.sort((a, b) => {
      const aCoordinate = verticalSide ? a.counterpart.cy : a.counterpart.cx;
      const bCoordinate = verticalSide ? b.counterpart.cy : b.counterpart.cx;
      if (aCoordinate !== bCoordinate) return aCoordinate - bCoordinate;
      const aKey = `${a.edge.id}\u0000${a.edge.from}\u0000${a.edge.to}\u0000${a.edge.label ?? ''}`;
      const bKey = `${b.edge.id}\u0000${b.edge.from}\u0000${b.edge.to}\u0000${b.edge.label ?? ''}`;
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });
    const extent = verticalSide ? items[0].rect.height : items[0].rect.width;
    const usable = Math.max(0, extent - gutter * 2);
    const spacing = Math.min(maxSpacing, usable / (items.length - 1));
    if (!(spacing > 0)) continue;

    // Width-aware callers reserve the whole group together.
    let offsets: number[] | undefined;
    if (spacingFor) {
      const gaps = items.slice(1).map((item, index) => Math.max(maxSpacing, spacingFor(items[index].edge, item.edge)));
      const span = gaps.reduce((sum, gap) => sum + gap, 0);
      if (span <= usable && gaps.some((gap) => gap > maxSpacing)) {
        let offset = -span / 2;
        offsets = [offset, ...gaps.map((gap) => (offset += gap))];
      }
    }
    for (const [index, item] of items.entries()) {
      const offset = offsets?.[index] ?? (index - (items.length - 1) / 2) * spacing;
      const point = anchor(item.rect, item.side);
      if (verticalSide) point[1] += offset;
      else point[0] += offset;
      const endpoints = spread.get(item.edge) ?? {};
      endpoints[item.endpoint] = point;
      spread.set(item.edge, endpoints);
    }
  }
  return spread;
}

export function polylinePath(points: readonly Point[]) {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${String(x)} ${String(y)}`).join(' ');
}

// The route as an SVG path, its corners rounded to `radius`.
export function roundedPath(points: readonly Point[], radius: number) {
  if (points.length < 3 || radius <= 0) return polylinePath(points);
  const commands = [`M ${String(points[0][0])} ${String(points[0][1])}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const prevLen = Math.hypot(cx - px, cy - py);
    const nextLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, prevLen / 2, nextLen / 2);
    if (r < 1) {
      commands.push(`L ${String(cx)} ${String(cy)}`);
      continue;
    }
    const before = [cx - ((cx - px) / prevLen) * r, cy - ((cy - py) / prevLen) * r];
    const after = [cx + ((nx - cx) / nextLen) * r, cy + ((ny - cy) / nextLen) * r];
    commands.push(`L ${String(before[0])} ${String(before[1])}`);
    commands.push(`Q ${String(cx)} ${String(cy)} ${String(after[0])} ${String(after[1])}`);
  }
  const [endX, endY] = points[points.length - 1];
  commands.push(`L ${String(endX)} ${String(endY)}`);
  return commands.join(' ');
}

// Where an edge's label sits by default: above the middle of a straight
// route, else above the middle of its second segment.
export function labelPoint(edge: Pick<RouteEdge, 'labelAt' | 'labelDx' | 'labelDy'>, points: readonly Point[]): Point {
  if (edge.labelAt) return edge.labelAt;
  const dx = edge.labelDx ?? 0;
  const dy = edge.labelDy ?? 0;
  if (points.length === 2) return [(points[0][0] + points[1][0]) / 2 + dx, points[0][1] - 10 + dy];
  const segmentIndex = Math.min(points.length - 2, 1);
  const a = points[segmentIndex];
  const b = points[segmentIndex + 1];
  return [(a[0] + b[0]) / 2 + dx, (a[1] + b[1]) / 2 - 10 + dy];
}

export type Frame = {
  radius: number;
} & Rect

// The straight parts of a frame's border, without its rounded corners.
export function frameBorderSegments(frame: Frame): Segment[] {
  if (!isFinitePoint(frame.x, frame.y, frame.width, frame.height) || frame.width <= 0 || frame.height <= 0) return [];
  const radius = Math.max(0, Math.min(frame.radius || 0, frame.width / 2, frame.height / 2));
  const left = frame.x;
  const right = frame.x + frame.width;
  const top = frame.y;
  const bottom = frame.y + frame.height;
  return ([
    { start: [left + radius, top], end: [right - radius, top] },
    { start: [right, top + radius], end: [right, bottom - radius] },
    { start: [right - radius, bottom], end: [left + radius, bottom] },
    { start: [left, bottom - radius], end: [left, top + radius] },
  ] satisfies Segment[]).filter(({ start, end }) => Math.hypot(end[0] - start[0], end[1] - start[1]) > 0.0001);
}

function collinearAxisOverlap(a: Point, b: Point, c: Point, d: Point) {
  const epsilon = 0.0001;
  const horizontal = Math.abs(a[1] - b[1]) <= epsilon && Math.abs(c[1] - d[1]) <= epsilon && Math.abs(a[1] - c[1]) <= epsilon;
  const vertical = Math.abs(a[0] - b[0]) <= epsilon && Math.abs(c[0] - d[0]) <= epsilon && Math.abs(a[0] - c[0]) <= epsilon;
  if (!horizontal && !vertical) return 0;
  const axis = horizontal ? 0 : 1;
  const low = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
  const high = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
  return high - low <= epsilon ? 0 : high - low;
}

// Whether a route runs along a frame border instead of crossing it.
export function routeFollowsFrameBorder(points: readonly Point[], frames: readonly Frame[]) {
  for (const frame of frames) {
    for (const border of frameBorderSegments(frame)) {
      for (let index = 0; index < points.length - 1; index += 1) {
        if (collinearAxisOverlap(points[index], points[index + 1], border.start, border.end) > 0.0001) return true;
      }
    }
  }
  return false;
}

const VARIATION_SELECTOR_FIRST = 0xfe00;
const VARIATION_SELECTOR_LAST = 0xfe0f;
const VARIATION_SELECTOR_EMOJI = 0xfe0f;
const FULLWIDTH_RE = /[ᄀ-ᅟ⌚-⌛〈-〉⏩-⏬⏰⏳◽-◾☔-☕☰-☷♈-♓♿⚊-⚏⚓⚡⚪-⚫⚽-⚾⛄-⛅⛎⛔⛪⛲-⛳⛵⛺⛽✅✊-✋✨❌❎❓-❕❗➕-➗➰➿⬛-⬜⭐⭕⺀-꓏ꥠ-ꥼ가-힣豈-﫿︐-︙︰-﹯！-｠￠-￦\u{16FE0}-\u{18DFF}\u{1AFF0}-\u{1AFFF}\u{1B000}-\u{1B2FF}\u{1F000}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;

// Text width in "ems of a narrow glyph": wide (CJK, emoji) characters count twice.
export function textUnits(text: string | undefined) {
  const chars = Array.from(text ?? '');
  let units = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const codePoint = chars[i].codePointAt(0) ?? 0;
    if (codePoint >= VARIATION_SELECTOR_FIRST && codePoint <= VARIATION_SELECTOR_LAST) continue;
    const next = i + 1 < chars.length ? chars[i + 1].codePointAt(0) : -1;
    if (next === VARIATION_SELECTOR_EMOJI) units += 2;
    else units += FULLWIDTH_RE.test(chars[i]) ? 2 : 1;
  }
  return units;
}

// Node text measures (Archify's renderers/shared/text-fit.mjs): px of
// advance per text unit per px of font, and the padding inside a box.
export const TEXT_WIDTH_FACTOR = 0.6;
export const NODE_TEXT_PADDING = 8;
// The width `text` takes at font `size`.
export const minimumTextWidth = (text: string, size: number) => textUnits(text) * size * TEXT_WIDTH_FACTOR;
// The width a box `width` wide leaves its text.
export const availableTextWidth = (width: number) => width - NODE_TEXT_PADDING;

// The largest font size, between `minimum` and `preferred`, at which `text`
// fits a node `width` wide.
export function fittedNodeFontSize(text: string, width: number, preferred: number, minimum: number) {
  const units = Math.max(1, textUnits(text));
  const available = Math.max(1, width - NODE_TEXT_PADDING);
  const fitted = Math.min(preferred, available / (units * TEXT_WIDTH_FACTOR));
  return Math.max(minimum, Math.floor(fitted * 10) / 10);
}

// The smallest source font size that still reads 6px on screen when a
// canvas `viewBoxWidth` wide is shown in the 930px desktop reading column.
export function minimumReadableSourceTextPx(viewBoxWidth: number) {
  return 6 / Math.min(1, 930 / viewBoxWidth);
}
