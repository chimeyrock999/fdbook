// Orthogonal edge router, ported from Archify (MIT,
// renderers/architecture/routing.mjs) with the options its architecture
// renderer uses fixed: distinct ports per edge, the readability sweep on, the
// composition floors enforced. Routes are planned once for the whole scene:
// edges with waypoints first, then the rest from shortest to longest, each
// keeping clear of nodes, frame borders, earlier routes and their labels.

import {
  alignAutomaticFacingPorts,
  anchor,
  automaticPortRhythmBridge,
  automaticPortSpread,
  chosenSide,
  collectRouteRhythmIssues,
  defaultFromSide,
  defaultToSide,
  frameBorderSegments,
  hasAuthoredRouteGeometry,
  normalizeRoutePoints,
  portHasCornerClearance,
  properSegmentIntersection,
  roundedPath,
  routeFollowsFrameBorder,
  routeHonorsEndpointSides,
  segmentIntersectsRect,
  type Box,
  type Frame,
  type Point,
  type Rect,
  type RouteEdge,
} from './geometry.ts';
import { orthogonalTouchOnInterior, shortestOrthogonalGridRoute } from './grid-route.ts';
import type { LabelRect } from './labels.ts';
import { improveRoutes } from './router-sweep.ts';
import type { Side } from '#model/schema.ts';

export interface Routed {
  points: Point[];
  d: string;
}
export interface Resolved {
  conn: RouteEdge;
  points: Point[];
}
export interface Sides {
  fromSide: Side;
  toSide: Side;
}
export interface EndpointGeometry extends Sides {
  from: Box;
  to: Box;
  start: Point;
  end: Point;
  crowded?: boolean;
}
export interface ReservedLabel {
  conn: RouteEdge;
  rect: LabelRect;
}
export type LabelRectFor = (conn: RouteEdge, points: Point[], context: { routes: Point[][]; labels: LabelRect[] }) => LabelRect | null;

export interface RouterOptions {
  // Structural frames whose borders a route may cross but never follow.
  frames: Frame[];
  // Frames an edge may end on instead of a node, by group id. They are no
  // obstacle: the nodes inside them are.
  groupBoxes: ReadonlyMap<string, Box>;
  labelRectFor: LabelRectFor | null;
  // Extra room below the scene the readability sweep may route through.
  readabilityBottomMargin: number;
}

const LABEL_CLEARANCE = 4;
const INTERIOR_SEGMENT_PX = 16;
const MICRO_SEGMENT_PX = 8;
export const AUTOMATIC_PORT_CORNER_GUTTER = 16;
const SIDE_ORDER: Side[] = ['right', 'bottom', 'left', 'top'];
const OUTWARD_SIDE_VECTOR: Record<Side, Point> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

export function relationshipsShareEndpoint(left: RouteEdge, right: RouteEdge) {
  return left.from === right.from || left.from === right.to || left.to === right.from || left.to === right.to;
}

export function hasAuthoredLabelPlacement(conn: RouteEdge) {
  return conn.labelAt !== undefined || conn.labelDx !== undefined || conn.labelDy !== undefined;
}

function collinearOverlapLength(leftStart: Point, leftEnd: Point, rightStart: Point, rightEnd: Point) {
  const epsilon = 0.0001;
  if (Math.abs(leftStart[0] - leftEnd[0]) <= epsilon && Math.abs(rightStart[0] - rightEnd[0]) <= epsilon
    && Math.abs(leftStart[0] - rightStart[0]) <= epsilon) {
    return Math.max(0, Math.min(Math.max(leftStart[1], leftEnd[1]), Math.max(rightStart[1], rightEnd[1]))
      - Math.max(Math.min(leftStart[1], leftEnd[1]), Math.min(rightStart[1], rightEnd[1])));
  }
  if (Math.abs(leftStart[1] - leftEnd[1]) <= epsilon && Math.abs(rightStart[1] - rightEnd[1]) <= epsilon
    && Math.abs(leftStart[1] - rightStart[1]) <= epsilon) {
    return Math.max(0, Math.min(Math.max(leftStart[0], leftEnd[0]), Math.max(rightStart[0], rightEnd[0]))
      - Math.max(Math.min(leftStart[0], leftEnd[0]), Math.min(rightStart[0], rightEnd[0])));
  }
  return 0;
}

function outwardStub(point: Point, side: Side, distance = 24): Point {
  const [dx, dy] = OUTWARD_SIDE_VECTOR[side];
  return [point[0] + dx * distance, point[1] + dy * distance];
}

function collinearBacktrack(a: Point, b: Point, c: Point) {
  const first = [b[0] - a[0], b[1] - a[1]];
  const second = [c[0] - b[0], c[1] - b[1]];
  const cross = first[0] * second[1] - first[1] * second[0];
  const dot = first[0] * second[0] + first[1] * second[1];
  return Math.abs(cross) <= 0.0001 && dot < -0.0001;
}

function sideAwareBridgeCandidates(start: Point, end: Point, fromSide: Side, toSide: Side): Point[][] {
  const startStub = outwardStub(start, fromSide);
  const endStub = outwardStub(end, toSide);
  const rawCandidates: Point[][] = [];
  const minimumBridge = 16;
  const vertical = (side: Side) => side === 'top' || side === 'bottom';

  // Port spreading can leave parallel-side anchors only a few pixels apart.
  // Route through a bounded outside channel so both endpoint normals stay.
  if (vertical(fromSide) && vertical(toSide) && Math.abs(start[0] - end[0]) < minimumBridge) {
    for (const channelX of [Math.max(start[0], end[0]) + minimumBridge, Math.min(start[0], end[0]) - minimumBridge]) {
      rawCandidates.push([startStub, [channelX, startStub[1]], [channelX, endStub[1]], endStub]);
    }
  }
  if (!vertical(fromSide) && !vertical(toSide) && Math.abs(start[1] - end[1]) < minimumBridge) {
    for (const channelY of [Math.max(start[1], end[1]) + minimumBridge, Math.min(start[1], end[1]) - minimumBridge]) {
      rawCandidates.push([startStub, [startStub[0], channelY], [endStub[0], channelY], endStub]);
    }
  }
  rawCandidates.push([startStub, [endStub[0], startStub[1]], endStub], [startStub, [startStub[0], endStub[1]], endStub]);
  return rawCandidates.map((candidate) => normalizeRoutePoints([start, ...candidate, end]))
    .filter((points) => points.length >= 2)
    .filter((points) => !collinearBacktrack(points[0], points[1], points[2] || points[1]))
    .filter((points) => !collinearBacktrack(points.at(-3) || points[points.length - 2], points[points.length - 2], points[points.length - 1]))
    .filter((points) => routeHonorsEndpointSides(points, fromSide, toSide))
    .sort((a, b) => a.length - b.length)
    .map((points) => points.slice(1, -1));
}

// The state the planning pass and the readability sweep share.
export interface RouterContext {
  components: ReadonlyMap<string, Box>;
  // The box an edge end attaches to: a node, or a group's frame.
  boxOf: (id: string) => Box | undefined;
  connections: readonly RouteEdge[];
  frames: Frame[];
  labelRectFor: LabelRectFor | null;
  readabilityBottomMargin: number;
  reservedLabels: ReservedLabel[];
  honourReservedLabels: boolean;
  allowGridSearch: boolean;
  selectedSides: Map<RouteEdge, Sides>;
  connectionGeometry: (conn: RouteEdge, sides?: Sides) => EndpointGeometry;
  routedForGeometry: (conn: RouteEdge, resolvedRoutes: readonly Resolved[], geometry: EndpointGeometry) => Routed;
  routeIsClear: (conn: RouteEdge, routed: { points: Point[] }, geometry: EndpointGeometry, resolvedRoutes: readonly Resolved[]) => boolean;
  crossingCount: (conn: RouteEdge, points: readonly Point[], resolvedRoutes: readonly Resolved[]) => number;
  readabilityCost: (conn: RouteEdge, routed: { points: readonly Point[] }, resolvedRoutes: readonly Resolved[]) => number;
  candidateSidePairs: (conn: RouteEdge) => Sides[];
  inferredConnectionSides: (conn: RouteEdge) => Sides;
  cachePath: (conn: RouteEdge, routed: Routed, sides: Sides) => Routed;
  portSpacing: (left: RouteEdge, right: RouteEdge) => number;
}

export function createRouter(components: ReadonlyMap<string, Box>, connections: readonly RouteEdge[], options: RouterOptions) {
  const { frames, groupBoxes, labelRectFor, readabilityBottomMargin } = options;
  const frameBorders = frames.flatMap((frame) => frameBorderSegments(frame));
  const boxOf = (id: string) => components.get(id) ?? groupBoxes.get(id);
  const ctx = {
    components, boxOf, connections, frames, labelRectFor, readabilityBottomMargin,
    reservedLabels: [] as ReservedLabel[],
    honourReservedLabels: true,
    allowGridSearch: true,
    selectedSides: new Map<RouteEdge, Sides>(),
  } as RouterContext;
  const pathCache = new Map<RouteEdge, Routed>();
  let gridSearchCount = 0;
  const maximumGridSearchCount = 64;

  function routeClearsReservedLabels(conn: RouteEdge, points: readonly Point[]) {
    if (!ctx.honourReservedLabels) return true;
    for (const entry of ctx.reservedLabels) {
      if (entry.conn === conn) continue;
      for (let index = 0; index < points.length - 1; index += 1) {
        if (segmentIntersectsRect({ start: points[index], end: points[index + 1] }, entry.rect, LABEL_CLEARANCE)) return false;
      }
    }
    return true;
  }

  // The grid search adds its own 2px component clearance; pre-expand so a
  // reserved label keeps the same 4px clearance the placement pass demands.
  function reservedLabelObstacles(gridClearance: number): Rect[] {
    if (!ctx.honourReservedLabels) return [];
    const grow = LABEL_CLEARANCE - gridClearance;
    return ctx.reservedLabels.map(({ rect }) => ({ x: rect.x - grow, y: rect.y - grow, width: rect.width + grow * 2, height: rect.height + grow * 2 }));
  }

  // Routes are held to the composition floors: no unreadably short segment,
  // never along a frame border.
  function routeMeetsCompositionFloors(points: readonly Point[]) {
    if (collectRouteRhythmIssues(points, INTERIOR_SEGMENT_PX, MICRO_SEGMENT_PX).length) return false;
    return !frames.length || !routeFollowsFrameBorder(points, frames);
  }

  function routeClearsComponents(conn: RouteEdge, points: readonly Point[], clearance = 2) {
    for (const component of components.values()) {
      if (component.id === conn.from || component.id === conn.to) continue;
      for (let index = 0; index < points.length - 1; index += 1) {
        if (segmentIntersectsRect({ start: points[index], end: points[index + 1] }, component, clearance)) return false;
      }
    }
    return routeClearsReservedLabels(conn, points);
  }

  function routeClearsEndpointComponents(points: readonly Point[], from: Box, to: Box) {
    const lastSegment = points.length - 2;
    for (let index = 0; index <= lastSegment; index += 1) {
      const segment = { start: points[index], end: points[index + 1] };
      if (index > 0 && segmentIntersectsRect(segment, from)) return false;
      if (index < lastSegment && segmentIntersectsRect(segment, to)) return false;
    }
    return true;
  }

  function unrelatedResolvedRoutes(conn: RouteEdge, resolvedRoutes: readonly Resolved[]) {
    return resolvedRoutes.filter((entry) => !relationshipsShareEndpoint(conn, entry.conn));
  }

  function routeConflictsWithResolved(conn: RouteEdge, points: readonly Point[], resolvedRoutes: readonly Resolved[]) {
    for (const entry of unrelatedResolvedRoutes(conn, resolvedRoutes)) {
      for (let left = 0; left < points.length - 1; left += 1) {
        for (let right = 0; right < entry.points.length - 1; right += 1) {
          if (properSegmentIntersection(points[left], points[left + 1], entry.points[right], entry.points[right + 1])) return true;
          if (orthogonalTouchOnInterior(points[left], points[left + 1], entry.points[right], entry.points[right + 1])) return true;
          if (collinearOverlapLength(points[left], points[left + 1], entry.points[right], entry.points[right + 1]) >= 8) return true;
        }
      }
    }
    return false;
  }

  // A common destination does not make two independently labelled routes a
  // bus: keep their corridors distinct too.
  const sharesBus = (conn: RouteEdge, other: RouteEdge) => relationshipsShareEndpoint(conn, other)
    && (hasAuthoredRouteGeometry(other) || Boolean(other.labelAt) || Boolean(conn.labelAt));

  function routeOverlapsResolved(conn: RouteEdge, points: readonly Point[], resolvedRoutes: readonly Resolved[]) {
    for (const entry of resolvedRoutes) {
      if (sharesBus(conn, entry.conn)) continue;
      for (let left = 0; left < points.length - 1; left += 1) {
        for (let right = 0; right < entry.points.length - 1; right += 1) {
          if (collinearOverlapLength(points[left], points[left + 1], entry.points[right], entry.points[right + 1]) >= 8) return true;
        }
      }
    }
    return false;
  }

  function crossingCount(conn: RouteEdge, points: readonly Point[], resolvedRoutes: readonly Resolved[]) {
    let count = 0;
    for (const entry of resolvedRoutes) {
      if (sharesBus(conn, entry.conn)) continue;
      let crosses = false;
      for (let index = 1; index < points.length && !crosses; index += 1) {
        for (let otherIndex = 1; otherIndex < entry.points.length; otherIndex += 1) {
          if (properSegmentIntersection(points[index - 1], points[index], entry.points[otherIndex - 1], entry.points[otherIndex])) {
            crosses = true;
            break;
          }
        }
      }
      if (crosses) count += 1;
    }
    return count;
  }

  // A reciprocal pair is repaired jointly after planning, so crossings that
  // involve it are not final yet; keep the established first choice there.
  const reciprocal = (conn: RouteEdge) => connections.some((other) => other.from === conn.to && other.to === conn.from);
  function siblingCrossings(conn: RouteEdge, points: readonly Point[], resolvedRoutes: readonly Resolved[]) {
    if (reciprocal(conn)) return 0;
    return crossingCount(conn, points, resolvedRoutes.filter((entry) => !reciprocal(entry.conn)));
  }

  function alignFacingPorts(conn: RouteEdge, from: Box, to: Box, start: Point, end: Point, fromSide: Side, toSide: Side, ports: { from: boolean; to: boolean }) {
    return alignAutomaticFacingPorts(conn, from, to, start, end, fromSide, toSide, ports,
      (points) => routeClearsEndpointComponents(points, from, to) && routeClearsComponents(conn, points));
  }

  // A route that passes every check against what is already placed.
  const plannable = (conn: RouteEdge, points: Point[], from: Box, to: Box, fromSide: Side, toSide: Side, resolvedRoutes: readonly Resolved[]) => (
    routeHonorsEndpointSides(points, fromSide, toSide)
    && routeClearsEndpointComponents(points, from, to)
    && routeClearsComponents(conn, points)
    && routeMeetsCompositionFloors(points)
    && !routeConflictsWithResolved(conn, points, resolvedRoutes)
  );

  function gridRoute(conn: RouteEdge, from: Box, to: Box, start: Point, end: Point, fromSide: Side, toSide: Side, resolvedRoutes: readonly Resolved[]) {
    // Siblings that share an end are avoided as corridors; other routes may
    // be crossed, and the renderer gives a crossing a halo.
    const avoidedSegments = resolvedRoutes
      .filter((entry) => relationshipsShareEndpoint(conn, entry.conn)
        && !hasAuthoredRouteGeometry(entry.conn) && !entry.conn.labelAt && !conn.labelAt)
      .flatMap((entry) => entry.points.slice(1).map((segmentEnd, index) => ({ start: entry.points[index], end: segmentEnd })));
    gridSearchCount += 1;
    const searched = shortestOrthogonalGridRoute({
      start,
      end,
      obstacles: [...components.values(), ...reservedLabelObstacles(2)],
      fromSide,
      toSide,
      clearance: 2,
      maximumObstacleCount: 80,
      endpointStubPx: 24,
      maximumGridNodes: 4096,
      avoidedSegments,
      allowAvoidedCrossings: true,
      minimumAvoidedOverlapPx: 8,
      routeSeparationPx: 8,
      minimumSegmentPx: INTERIOR_SEGMENT_PX,
      borderSegments: frameBorders,
      bendPenaltyPx: 48,
    });
    if (searched
      && routeClearsEndpointComponents(searched, from, to)
      && routeClearsComponents(conn, searched)
      && !routeOverlapsResolved(conn, searched, resolvedRoutes)
      && routeMeetsCompositionFloors(searched)) return searched.slice(1, -1);
    return null;
  }

  function routeVia(conn: RouteEdge, from: Box, to: Box, start: Point, end: Point, fromSide: Side, toSide: Side, resolvedRoutes: readonly Resolved[] = []): Point[] {
    if (conn.via) return conn.via;
    // Direct line unless the anchors are clearly orthogonal-friendly.
    const deltaX = Math.abs(start[0] - end[0]);
    const deltaY = Math.abs(start[1] - end[1]);
    if ((deltaX < 4 || deltaY < 4) && plannable(conn, [start, end], from, to, fromSide, toSide, resolvedRoutes)) return [];

    const rhythmBridge = automaticPortRhythmBridge(start, end, fromSide, toSide, (points) => (
      routeClearsEndpointComponents(points, from, to)
      && routeClearsComponents(conn, points)
      && routeMeetsCompositionFloors(points)
      && !routeConflictsWithResolved(conn, points, resolvedRoutes)
    ));
    if (rhythmBridge) return rhythmBridge.slice(1, -1);

    // Spread ports can leave otherwise aligned endpoints a few pixels apart;
    // a midpoint route would split that into two unreadable stubs, so take a
    // bounded outside channel when both anchors sit on parallel sides.
    const minimumStub = 8;
    const fromVerticalSide = start[1] === from.y || start[1] === from.y + from.height;
    const toVerticalSide = end[1] === to.y || end[1] === to.y + to.height;
    const outside = (candidate: Point[]) => {
      const points = [start, ...candidate, end];
      return routeHonorsEndpointSides(points, fromSide, toSide)
        && routeClearsComponents(conn, points)
        && routeMeetsCompositionFloors(points)
        && !routeConflictsWithResolved(conn, points, resolvedRoutes);
    };
    if (fromVerticalSide && toVerticalSide && deltaX < minimumStub * 2) {
      for (const channelX of [Math.max(start[0], end[0]) + minimumStub * 2, Math.min(start[0], end[0]) - minimumStub * 2]) {
        const candidate: Point[] = [[channelX, start[1]], [channelX, end[1]]];
        if (outside(candidate)) return candidate;
      }
    }
    const fromHorizontalSide = start[0] === from.x || start[0] === from.x + from.width;
    const toHorizontalSide = end[0] === to.x || end[0] === to.x + to.width;
    if (fromHorizontalSide && toHorizontalSide && deltaY < minimumStub * 2) {
      for (const channelY of [Math.max(start[1], end[1]) + minimumStub * 2, Math.min(start[1], end[1]) - minimumStub * 2]) {
        const candidate: Point[] = [[start[0], channelY], [end[0], channelY]];
        if (outside(candidate)) return candidate;
      }
    }

    const midX = (start[0] + end[0]) / 2;
    const horizontalFirst: Point[] = [[midX, start[1]], [midX, end[1]]];
    const midY = (start[1] + end[1]) / 2;
    const verticalFirst: Point[] = [[start[0], midY], [end[0], midY]];
    const sideSafe = [horizontalFirst, verticalFirst].filter((candidate) => routeHonorsEndpointSides([start, ...candidate, end], fromSide, toSide));
    const sideAware = sideAwareBridgeCandidates(start, end, fromSide, toSide);
    const vertical = (side: Side) => side === 'top' || side === 'bottom';
    const nearParallelPorts = (vertical(fromSide) && vertical(toSide) && deltaX < minimumStub * 2)
      || (!vertical(fromSide) && !vertical(toSide) && deltaY < minimumStub * 2);
    const ordered = nearParallelPorts ? [...sideAware, ...sideSafe] : [...sideSafe, ...sideAware];
    let firstFeasible: Point[] | null = null;
    for (const candidate of ordered) {
      const points = [start, ...candidate, end];
      if (!(routeClearsEndpointComponents(points, from, to)
        && routeClearsComponents(conn, points)
        && routeMeetsCompositionFloors(points)
        && !routeConflictsWithResolved(conn, points, resolvedRoutes)
        && !routeOverlapsResolved(conn, points, resolvedRoutes)
        && !siblingCrossings(conn, points, resolvedRoutes))) continue;
      if (!conn.label || !labelRectFor || labelRectFor(conn, points, {
        routes: resolvedRoutes.map((entry) => entry.points),
        labels: ctx.reservedLabels.map((entry) => entry.rect),
      })) return candidate;
      firstFeasible ||= candidate;
    }
    if (firstFeasible) return firstFeasible;
    // Siblings fanning out from one side all want the same midpoint channel:
    // step outward through the corridor to a free parallel channel.
    const channels = (low0: number, high0: number, mid: number) => {
      const [low, high] = [Math.min(low0, high0) + 24, Math.max(low0, high0) - 24];
      const values: number[] = [];
      for (let offset = 16; mid - offset >= low || mid + offset <= high; offset += 16) {
        values.push(...[mid + offset, mid - offset].filter((value) => value >= low && value <= high));
      }
      return values;
    };
    for (const candidate of [
      ...channels(start[0], end[0], midX).map((x): Point[] => [[x, start[1]], [x, end[1]]]),
      ...channels(start[1], end[1], midY).map((y): Point[] => [[start[0], y], [end[0], y]]),
    ]) {
      const points = [start, ...candidate, end];
      if (plannable(conn, points, from, to, fromSide, toSide, resolvedRoutes)
        && !routeOverlapsResolved(conn, points, resolvedRoutes)
        && !siblingCrossings(conn, points, resolvedRoutes)) return candidate;
    }

    // Both bounded doglegs are blocked: search a bounded obstacle grid before
    // falling back to a route that breaks the endpoint directions.
    const fallback = sideSafe[0] || sideAware[0] || horizontalFirst;
    if (!ctx.allowGridSearch || gridSearchCount >= maximumGridSearchCount) return fallback;
    return gridRoute(conn, from, to, start, end, fromSide, toSide, resolvedRoutes) ?? fallback;
  }

  // A node's neighbours laid out as one row below (or above) it read as a
  // fan-out: reach them all through the same vertical side.
  const neighbourRects = new Map<string, Box[]>();
  for (const conn of connections) {
    const from = boxOf(conn.from);
    const to = boxOf(conn.to);
    if (!from || !to || from === to) continue;
    for (const [node, other] of [[from, to], [to, from]]) {
      neighbourRects.set(node.id, [...(neighbourRects.get(node.id) ?? []), other]);
    }
  }
  function rowFanOutSides(from: Box, to: Box): Sides | null {
    const verticalSides = (node: Box, other: Box): Side | null => {
      const below = other.y >= node.y + node.height;
      if (!below && other.y + other.height > node.y) return null;
      if (['top', 'bottom'].includes(defaultFromSide(node, other))) return null;
      const rowSibling = (neighbourRects.get(node.id) ?? []).some((sibling) => sibling !== other
        && Math.abs(sibling.cy - other.cy) < 1
        && defaultFromSide(node, sibling) === (below ? 'bottom' : 'top'));
      // Only when a node of that row blocks a sideways route to one of the
      // neighbours on this side; decide per side so a row never mixes styles.
      const blocked = (target: Box) => {
        const [gapStart, gapEnd] = target.cx < node.cx ? [target.x + target.width, node.x] : [node.x + node.width, target.x];
        return [...components.values()].some((rect) => rect !== node && rect !== target
          && rect.y < target.y + target.height && rect.y + rect.height > target.y
          && rect.x < gapEnd && rect.x + rect.width > gapStart);
      };
      const sameSide = (neighbourRects.get(node.id) ?? []).filter((sibling) => Math.abs(sibling.cy - other.cy) < 1
        && defaultFromSide(node, sibling) === defaultFromSide(node, other));
      return rowSibling && sameSide.some(blocked) ? (below ? 'bottom' : 'top') : null;
    };
    const opposite: Record<'top' | 'bottom', Side> = { top: 'bottom', bottom: 'top' };
    const fromSide = verticalSides(from, to);
    if (fromSide) return { fromSide, toSide: opposite[fromSide as 'top' | 'bottom'] };
    const toSide = verticalSides(to, from);
    return toSide ? { fromSide: opposite[toSide as 'top' | 'bottom'], toSide } : null;
  }

  const stroke = (relation: RouteEdge) => (relation.variant === 'emphasis' ? 1.8 : 1.5);
  const markerSpacing = (left: RouteEdge, right: RouteEdge) => 3.5 * (stroke(left) + stroke(right));
  const portSpacing = (left: RouteEdge, right: RouteEdge) => Math.max(14, markerSpacing(left, right) + 3.5);
  function inferredSide(conn: RouteEdge, endpoint: 'source' | 'target') {
    const fanOut = rowFanOutSides(boxOf(conn.from)!, boxOf(conn.to)!);
    return endpoint === 'source' ? fanOut?.fromSide : fanOut?.toSide;
  }
  // Only groups whose arrowheads cannot fit the 14px slots are widened.
  const automaticPorts = automaticPortSpread(connections, new Map([...groupBoxes, ...components]), {
    sideFor: inferredSide,
    spacingFor: (left, right) => (markerSpacing(left, right) > 14 ? portSpacing(left, right) : 14),
  });
  const incidentEndpoints = new Map<string, { conn: RouteEdge; field: 'from' | 'to'; sideField: keyof Sides }[]>();
  for (const conn of connections) {
    if (!boxOf(conn.from) || !boxOf(conn.to)) continue;
    for (const [field, sideField] of [['from', 'fromSide'], ['to', 'toSide']] as const) {
      incidentEndpoints.set(conn[field], [...(incidentEndpoints.get(conn[field]) ?? []), { conn, field, sideField }]);
    }
  }
  function inferredConnectionSides(conn: RouteEdge): Sides {
    const from = boxOf(conn.from)!;
    const to = boxOf(conn.to)!;
    return {
      fromSide: chosenSide(conn.fromSide, inferredSide(conn, 'source') || defaultFromSide(from, to)),
      toSide: chosenSide(conn.toSide, inferredSide(conn, 'target') || defaultToSide(from, to)),
    };
  }

  // A route can change sides after the initial port spread. Reserve slots on
  // the final side as well, so an arrow never lands on another one.
  function automaticEndpoint(conn: RouteEdge, endpoint: 'from' | 'to', rect: Box, side: Side, inferred: Side) {
    const initial = side === inferred ? automaticPorts.get(conn)?.[endpoint] : undefined;
    const preferred = initial || anchor(rect, side);
    if (hasAuthoredRouteGeometry(conn) || conn.labelAt) return { point: preferred, spread: Boolean(initial) };
    const axis = side === 'left' || side === 'right' ? 1 : 0;
    const occupied: { value: number; spacing: number }[] = [];
    for (const { conn: other, field, sideField } of incidentEndpoints.get(rect.id) ?? []) {
      if (other === conn || hasAuthoredRouteGeometry(other) || other.labelAt) continue;
      const routed = pathCache.get(other);
      const sides = ctx.selectedSides.get(other) || inferredConnectionSides(other);
      if (sides[sideField] !== side) continue;
      const point = routed
        ? (field === 'from' ? routed.points[0] : routed.points[routed.points.length - 1])
        : automaticPorts.get(other)?.[field] || anchor(rect, side);
      occupied.push({ value: point[axis], spacing: portSpacing(conn, other) });
    }
    if (!occupied.length) return { point: preferred, spread: Boolean(initial) };
    // On an alternate side, equally close slots should approach the other node.
    const counterpart = boxOf(endpoint === 'from' ? conn.to : conn.from)!;
    const toward = side === inferred ? preferred[axis] : (axis === 1 ? counterpart.cy : counterpart.cx);
    const candidates = [preferred[axis], ...occupied.flatMap(({ value, spacing }) => [value - spacing, value + spacing])]
      .sort((a, b) => Math.abs(a - preferred[axis]) - Math.abs(b - preferred[axis]) || Math.abs(a - toward) - Math.abs(b - toward) || a - b);
    for (const value of candidates) {
      const point: Point = [preferred[0], preferred[1]];
      point[axis] = value;
      if (portHasCornerClearance(rect, side, point) && occupied.every((other) => Math.abs(value - other.value) >= other.spacing - 0.0001)) {
        return { point, spread: true };
      }
    }
    return { point: preferred, spread: true, crowded: true };
  }

  function connectionGeometry(conn: RouteEdge, sides = inferredConnectionSides(conn)): EndpointGeometry {
    const from = boxOf(conn.from)!;
    const to = boxOf(conn.to)!;
    const inferred = inferredConnectionSides(conn);
    const { fromSide, toSide } = sides;
    const source = automaticEndpoint(conn, 'from', from, fromSide, inferred.fromSide);
    const target = automaticEndpoint(conn, 'to', to, toSide, inferred.toSide);
    const { start, end } = alignFacingPorts(conn, from, to, source.point, target.point, fromSide, toSide, { from: source.spread, to: target.spread });
    return { from, to, start, end, fromSide, toSide, crowded: source.crowded || target.crowded };
  }

  function routedForGeometry(conn: RouteEdge, resolvedRoutes: readonly Resolved[], geometry: EndpointGeometry): Routed {
    const { from, to, start, end, fromSide, toSide } = geometry;
    const authoredPoints = [start, ...routeVia(conn, from, to, start, end, fromSide, toSide, resolvedRoutes), end];
    // Explicit waypoints are the author's: keep even a collinear one.
    const points = hasAuthoredRouteGeometry(conn) ? authoredPoints : normalizeRoutePoints(authoredPoints);
    return { d: roundedPath(points, 8), points };
  }

  function cachePath(conn: RouteEdge, routed: Routed, sides: Sides) {
    pathCache.set(conn, routed);
    ctx.selectedSides.set(conn, { fromSide: sides.fromSide, toSide: sides.toSide });
    return routed;
  }

  function candidateSidePairs(conn: RouteEdge): Sides[] {
    const inferred = inferredConnectionSides(conn);
    const fromOptions = conn.fromSide ? [conn.fromSide] : [inferred.fromSide, ...SIDE_ORDER.filter((side) => side !== inferred.fromSide)];
    const toOptions = conn.toSide ? [conn.toSide] : [inferred.toSide, ...SIDE_ORDER.filter((side) => side !== inferred.toSide)];
    const distance = (sides: Sides) => {
      const geometry = connectionGeometry(conn, sides);
      return Math.abs(geometry.end[0] - geometry.start[0]) + Math.abs(geometry.end[1] - geometry.start[1]);
    };
    return fromOptions.flatMap((fromSide) => toOptions.map((toSide) => ({
      fromSide,
      toSide,
      deviationCount: Number(fromSide !== inferred.fromSide) + Number(toSide !== inferred.toSide),
    }))).sort((left, right) => left.deviationCount - right.deviationCount || distance(left) - distance(right))
      .map(({ fromSide, toSide }) => ({ fromSide, toSide }));
  }

  function routeIsClear(conn: RouteEdge, routed: { points: Point[] }, geometry: EndpointGeometry, resolvedRoutes: readonly Resolved[]) {
    return !geometry.crowded && routed.points.length >= 2
      && routeHonorsEndpointSides(routed.points, geometry.fromSide, geometry.toSide)
      && routeClearsEndpointComponents(routed.points, geometry.from, geometry.to)
      && routeClearsComponents(conn, routed.points)
      && routeMeetsCompositionFloors(routed.points)
      && !routeOverlapsResolved(conn, routed.points, resolvedRoutes);
  }

  // A crossover is a reading cost even with a halo; keep it finite so
  // avoiding one never justifies an arbitrarily long detour.
  function readabilityCost(conn: RouteEdge, routed: { points: readonly Point[] }, resolvedRoutes: readonly Resolved[]) {
    const points = routed.points;
    const length = points.slice(1).reduce((total, point, index) => total
      + Math.abs(point[0] - points[index][0]) + Math.abs(point[1] - points[index][1]), 0);
    return length + Math.max(0, points.length - 2) * 48 + crossingCount(conn, points, resolvedRoutes) * 160;
  }

  const routeLength = ({ routed }: { routed: Routed }) => routed.points.slice(1)
    .reduce((total, point, index) => total + Math.abs(point[0] - routed.points[index][0]) + Math.abs(point[1] - routed.points[index][1]), 0);

  function computePath(conn: RouteEdge, resolvedRoutes: readonly Resolved[]) {
    if (hasAuthoredRouteGeometry(conn)) {
      const sides = inferredConnectionSides(conn);
      return cachePath(conn, routedForGeometry(conn, resolvedRoutes, connectionGeometry(conn, sides)), sides);
    }
    let firstFallback: { routed: Routed; sides: Sides } | null = null;
    const clearRoute = () => {
      for (const sides of candidateSidePairs(conn)) {
        const geometry = connectionGeometry(conn, sides);
        const routed = routedForGeometry(conn, resolvedRoutes, geometry);
        firstFallback ??= { routed, sides };
        if (routeIsClear(conn, routed, geometry, resolvedRoutes)) return { routed, sides };
      }
      return null;
    };
    // Reserved labels are a preference, not an obstacle: a route that would
    // detour far around them takes the plain route and the label moves.
    ctx.honourReservedLabels = true;
    let chosen = clearRoute();
    if (ctx.reservedLabels.length) {
      ctx.honourReservedLabels = false;
      if (!chosen) chosen = clearRoute();
      else {
        const points = chosen.routed.points;
        const direct = Math.abs(points[points.length - 1][0] - points[0][0]) + Math.abs(points[points.length - 1][1] - points[0][1]);
        if (routeLength(chosen) > direct * 1.25 + 64) {
          const plain = clearRoute();
          if (plain && routeLength(plain) * 1.25 + 64 < routeLength(chosen)) chosen = plain;
        }
      }
      ctx.honourReservedLabels = true;
    }
    const picked = chosen ?? firstFallback!;
    return cachePath(conn, picked.routed, picked.sides);
  }

  Object.assign(ctx, {
    connectionGeometry, routedForGeometry, routeIsClear, crossingCount, readabilityCost,
    candidateSidePairs, inferredConnectionSides, cachePath, portSpacing,
  });

  let routesPlanned = false;
  function planRoutes() {
    if (routesPlanned) return;
    routesPlanned = true;
    const indexed = connections.map((conn, index) => ({ conn, index }))
      .filter(({ conn }) => boxOf(conn.from) && boxOf(conn.to));
    const explicit = indexed.filter(({ conn }) => hasAuthoredRouteGeometry(conn));
    const centreDistance = (conn: RouteEdge) => {
      const from = boxOf(conn.from)!;
      const to = boxOf(conn.to)!;
      return Math.abs(to.cx - from.cx) + Math.abs(to.cy - from.cy);
    };
    const automatic = indexed.filter(({ conn }) => !hasAuthoredRouteGeometry(conn))
      .sort((left, right) => centreDistance(left.conn) - centreDistance(right.conn) || left.index - right.index);
    const resolvedRoutes: Resolved[] = [];
    ctx.reservedLabels = [];
    for (const { conn } of [...explicit, ...automatic]) {
      const routed = computePath(conn, resolvedRoutes);
      resolvedRoutes.push({ conn, points: routed.points });
      const rect = labelRectFor?.(conn, routed.points, {
        routes: resolvedRoutes.map((entry) => entry.points),
        labels: ctx.reservedLabels.map((entry) => entry.rect),
      });
      if (rect) ctx.reservedLabels.push({ conn, rect });
    }
    // Improve against the complete set of routes, not only earlier edges.
    ctx.allowGridSearch = false;
    try {
      improveRoutes(ctx, resolvedRoutes);
    } finally {
      ctx.allowGridSearch = true;
    }
  }

  function pathFor(conn: RouteEdge): Routed {
    planRoutes();
    return pathCache.get(conn) ?? computePath(conn, []);
  }

  function connectionSides(conn: RouteEdge): Sides {
    planRoutes();
    return ctx.selectedSides.get(conn) || inferredConnectionSides(conn);
  }

  return { pathFor, connectionSides };
}
