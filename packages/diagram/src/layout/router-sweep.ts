// The router's readability sweep, ported from Archify (MIT,
// renderers/architecture/routing.mjs, the second half of planRoutes): after
// every edge has a route, revisit the ones with a reading cost (a crossing,
// many bends, no room for the label) one at a time, keeping every other
// route and label fixed, and take a cheaper route when one passes the same
// checks. No grid search runs here.

import { hasAuthoredRouteGeometry, normalizeRoutePoints, portHasCornerClearance, rectsOverlap, roundedPath, segmentIntersectsRect, type Box, type Point, type Rect, type RouteEdge } from './geometry.ts';
import type { LabelRect } from './labels.ts';
import { AUTOMATIC_PORT_CORNER_GUTTER, hasAuthoredLabelPlacement, type EndpointGeometry, type ReservedLabel, type Resolved, type RouterContext, type Routed, type Sides } from './router.ts';
import type { Side } from '#model/schema.ts';

const LABEL_CLEARANCE = 4;

export function improveRoutes(ctx: RouterContext, resolvedRoutes: Resolved[]) {
  const { components, frames, labelRectFor } = ctx;
  const scenePoints: Point[] = resolvedRoutes.flatMap((entry) => entry.points);
  for (const rect of [...components.values(), ...frames, ...ctx.reservedLabels.map((entry) => entry.rect)]) {
    scenePoints.push([rect.x, rect.y], [rect.x + rect.width, rect.y + rect.height]);
  }
  const bounds = {
    left: Math.min(...scenePoints.map(([x]) => x)),
    right: Math.max(...scenePoints.map(([x]) => x)),
    top: Math.min(...scenePoints.map(([, y]) => y)),
    bottom: Math.max(...scenePoints.map(([, y]) => y)),
  };
  const withinScene = ([x, y]: Point) => x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  const jointlyImproved = new Set<RouteEdge>();
  const fixed = (conn: RouteEdge) => jointlyImproved.has(conn) || hasAuthoredRouteGeometry(conn) || hasAuthoredLabelPlacement(conn);
  // Every routed edge has chosen its sides by the time the sweep runs.
  const selectedSides = (candidate: RouteEdge) => {
    const sides = ctx.selectedSides.get(candidate);
    if (!sides) throw new Error(`Edge "${candidate.id}" has no chosen sides.`);
    return sides;
  };
  const sidesOf = (conn: RouteEdge, sides: Sides) => (candidate: RouteEdge) => (candidate === conn ? sides : selectedSides(candidate));
  const overlapsNode = (rect: Rect | null) => Boolean(rect && [...components.values()].some((component) => rectsOverlap(rect, component, -2)));
  const labelFor = (conn: RouteEdge, points: Point[], routes: Point[][], labels: readonly ReservedLabel[]) => labelRectFor?.(conn, points, {
    routes,
    labels: labels.map((label) => label.rect),
  }) ?? null;

  // No two ends on one node side closer than their arrows need.
  const endpointSlotsClear = (candidateRoutes: Resolved[], others: readonly Resolved[], sideFor: (conn: RouteEdge) => Sides) => {
    const entries = [...others, ...candidateRoutes];
    for (const candidate of candidateRoutes) {
      const sides = sideFor(candidate.conn);
      for (const [componentId, side, point] of [
        [candidate.conn.from, sides.fromSide, candidate.points[0]],
        [candidate.conn.to, sides.toSide, candidate.points[candidate.points.length - 1]],
      ] as const) {
        const coordinate = side === 'left' || side === 'right' ? 1 : 0;
        for (const other of entries) {
          if (other.conn === candidate.conn) continue;
          const otherSides = sideFor(other.conn);
          for (const [otherId, otherSide, otherPoint] of [
            [other.conn.from, otherSides.fromSide, other.points[0]],
            [other.conn.to, otherSides.toSide, other.points[other.points.length - 1]],
          ] as const) {
            if (componentId === otherId && side === otherSide
              && Math.abs(point[coordinate] - otherPoint[coordinate]) < ctx.portSpacing(candidate.conn, other.conn) - 0.0001) return false;
          }
        }
      }
    }
    return true;
  };
  const labelClears = (rect: LabelRect | null, owner: RouteEdge, entries: readonly Resolved[], labels: readonly ReservedLabel[]) => {
    if (!rect) return !owner.label;
    if (!withinScene([rect.x, rect.y]) || !withinScene([rect.x + rect.width, rect.y + rect.height])
      || labels.some((other) => rectsOverlap(rect, other.rect, 2))) return false;
    return entries.every((entry) => entry.conn === owner || entry.points.slice(1).every((end, index) =>
      !segmentIntersectsRect({ start: entry.points[index], end }, rect, LABEL_CLEARANCE)));
  };
  const autoSides = (conn: RouteEdge) => !conn.fromSide && !conn.toSide;

  // A one-route sweep cannot repair reciprocal facing edges whose initial
  // spread groups differ. Try both direct lanes together.
  function improveReciprocalPairs() {
    const paired = new Set<RouteEdge>();
    for (const first of resolvedRoutes) {
      const conn = first.conn;
      if (paired.has(conn) || hasAuthoredRouteGeometry(conn) || hasAuthoredLabelPlacement(conn) || !autoSides(conn)) continue;
      const second = resolvedRoutes.find((entry) => entry !== first && entry.conn.from === conn.to && entry.conn.to === conn.from
        && !hasAuthoredRouteGeometry(entry.conn) && !hasAuthoredLabelPlacement(entry.conn) && autoSides(entry.conn));
      if (!second) continue;
      paired.add(conn);
      paired.add(second.conn);
      const firstSides = ctx.inferredConnectionSides(conn);
      const secondSides = ctx.inferredConnectionSides(second.conn);
      const facing = (sides: Sides, fromSide: Side, toSide: Side) => sides.fromSide === fromSide && sides.toSide === toSide;
      const horizontal = (facing(firstSides, 'right', 'left') && facing(secondSides, 'left', 'right'))
        || (facing(firstSides, 'left', 'right') && facing(secondSides, 'right', 'left'));
      const vertical = (facing(firstSides, 'bottom', 'top') && facing(secondSides, 'top', 'bottom'))
        || (facing(firstSides, 'top', 'bottom') && facing(secondSides, 'bottom', 'top'));
      if (!horizontal && !vertical) continue;
      if (first.points.length <= 2 && second.points.length <= 2) continue;
      const axis = horizontal ? 1 : 0;
      const others = resolvedRoutes.filter((entry) => entry !== first && entry !== second);
      const firstGeometry = ctx.connectionGeometry(conn, firstSides);
      const secondGeometry = ctx.connectionGeometry(second.conn, secondSides);
      if (firstGeometry.crowded || secondGeometry.crowded) continue;
      const previousLabels = ctx.reservedLabels;
      let improved = false;
      ctx.reservedLabels = ctx.reservedLabels.filter((entry) => entry.conn !== conn && entry.conn !== second.conn);
      try {
        const lanes = (geometry: EndpointGeometry) => [...new Set([geometry.start[axis], geometry.end[axis]])];
        const direct = (geometry: EndpointGeometry, lane: number): Routed => {
          const start: Point = [geometry.start[0], geometry.start[1]];
          const end: Point = [geometry.end[0], geometry.end[1]];
          start[axis] = lane;
          end[axis] = lane;
          return { points: [start, end], d: roundedPath([start, end], 8) };
        };
        const pairSides = (candidate: RouteEdge) => (candidate === conn ? firstSides
          : candidate === second.conn ? secondSides : selectedSides(candidate));
        let best: { firstRoute: Resolved & Routed; secondRoute: Resolved & Routed; firstRect: LabelRect | null; secondRect: LabelRect | null } | null = null;
        let bestCost = ctx.readabilityCost(conn, first, [...others, second]) + ctx.readabilityCost(second.conn, second, [...others, first]);
        for (const firstLane of lanes(firstGeometry)) {
          for (const secondLane of lanes(secondGeometry)) {
            const firstRoute = { conn, ...direct(firstGeometry, firstLane) };
            const secondRoute = { conn: second.conn, ...direct(secondGeometry, secondLane) };
            const candidates = [firstRoute, secondRoute];
            if (!candidates.every((entry) => entry.points.every(withinScene))) continue;
            if (!endpointSlotsClear(candidates, others, pairSides)) continue;
            if (!candidates.every((entry, index) => {
              const geometry = entry.conn === conn ? firstGeometry : secondGeometry;
              if (!portHasCornerClearance(geometry.from, geometry.fromSide, entry.points[0])
                || !portHasCornerClearance(geometry.to, geometry.toSide, entry.points[entry.points.length - 1])) return false;
              return ctx.routeIsClear(entry.conn, entry, geometry, [...others, candidates[1 - index]]);
            })) continue;
            const routes = [...others.map((entry) => entry.points), ...candidates.map((entry) => entry.points)];
            const firstRect = labelFor(conn, firstRoute.points, routes, ctx.reservedLabels);
            if (!labelClears(firstRect, conn, [...others, secondRoute], ctx.reservedLabels)) continue;
            const withFirst = [...ctx.reservedLabels, ...(firstRect ? [{ conn, rect: firstRect }] : [])];
            const secondRect = labelFor(second.conn, secondRoute.points, routes, withFirst);
            if (!labelClears(secondRect, second.conn, [...others, firstRoute], withFirst)) continue;
            const cost = ctx.readabilityCost(conn, firstRoute, [...others, secondRoute]) + ctx.readabilityCost(second.conn, secondRoute, [...others, firstRoute]);
            if (cost < bestCost) {
              best = { firstRoute, secondRoute, firstRect, secondRect };
              bestCost = cost;
            }
          }
        }
        if (!best) continue;
        ctx.cachePath(conn, best.firstRoute, firstSides);
        ctx.cachePath(second.conn, best.secondRoute, secondSides);
        first.points = best.firstRoute.points;
        second.points = best.secondRoute.points;
        jointlyImproved.add(conn);
        jointlyImproved.add(second.conn);
        improved = true;
        ctx.reservedLabels = [
          ...ctx.reservedLabels,
          ...(best.firstRect ? [{ conn, rect: best.firstRect }] : []),
          ...(best.secondRect ? [{ conn: second.conn, rect: best.secondRect }] : []),
        ];
      } finally {
        if (!improved) ctx.reservedLabels = previousLabels;
      }
    }
  }

  // A provisional label may occupy an otherwise clear corridor. Move at most
  // one automatic label, on its existing route, and accept the pair only
  // when both labels fit without borrowing other labels' space.
  function relocatedLabelsFor(conn: RouteEdge, routed: Routed, others: readonly Resolved[]) {
    const displaced = ctx.reservedLabels.filter((label) => label.conn !== conn && routed.points.slice(1).some((end, index) =>
      segmentIntersectsRect({ start: routed.points[index], end }, label.rect, LABEL_CLEARANCE)));
    if (displaced.length !== 1) return null;
    const owner = displaced[0].conn;
    if (hasAuthoredRouteGeometry(owner) || hasAuthoredLabelPlacement(owner)) return null;
    const labels = ctx.reservedLabels.filter((label) => label.conn !== conn && label.conn !== owner);
    const routes = [...others, { conn, points: routed.points }];
    const moved = routes.find((entry) => entry.conn === owner);
    if (!moved) throw new Error(`The label of edge "${owner.id}" has no route.`);
    for (const entry of [moved, { conn, points: routed.points }]) {
      const rect = labelFor(entry.conn, entry.points, routes.map((route) => route.points), labels);
      if (!labelClears(rect, entry.conn, routes, labels) || overlapsNode(rect)) return null;
      if (rect) labels.push({ conn: entry.conn, rect });
    }
    return labels;
  }

  function improveComplexRoutes(onlyCrossings = false) {
    for (const entry of resolvedRoutes) {
      const { conn } = entry;
      if (fixed(conn)) continue;
      const others = resolvedRoutes.filter((other) => other !== entry);
      // Spend the comparison budget where the scene has a reading cost: a
      // crossover, more than two bends, or no room for the label.
      const crossingsBefore = ctx.crossingCount(conn, entry.points, others);
      const otherLabels = ctx.reservedLabels.filter((label) => label.conn !== conn);
      const currentLabel = labelFor(conn, entry.points, others.map((other) => other.points), otherLabels);
      const labelBlocked = Boolean(conn.label && labelRectFor && !currentLabel);
      if (!labelBlocked && crossingsBefore === 0 && (onlyCrossings || entry.points.length <= 4)) continue;
      let best: { routed: Routed; sides: Sides; rect: LabelRect | null } | null = null;
      let bestCost = labelBlocked ? Infinity : ctx.readabilityCost(conn, entry, others);
      for (const sides of ctx.candidateSidePairs(conn)) {
        const geometry = ctx.connectionGeometry(conn, sides);
        const routed = ctx.routedForGeometry(conn, others, geometry);
        if (!routed.points.every(withinScene) || !ctx.routeIsClear(conn, routed, geometry, others)) continue;
        if (onlyCrossings && ctx.crossingCount(conn, routed.points, others) >= crossingsBefore) continue;
        const cost = ctx.readabilityCost(conn, routed, others);
        if (cost >= bestCost) continue;
        const rect = labelFor(conn, routed.points, [...others.map((other) => other.points), routed.points], otherLabels);
        // A shorter route must not widen and shrink the graph.
        if (labelRectFor && !labelClears(rect, conn, others, otherLabels)) continue;
        if (onlyCrossings && (!endpointSlotsClear([{ conn, points: routed.points }], others, sidesOf(conn, sides)) || overlapsNode(rect))) continue;
        best = { routed, sides, rect };
        bestCost = cost;
      }
      if (!best) continue;
      ctx.cachePath(conn, best.routed, best.sides);
      entry.points = best.routed.points;
      ctx.reservedLabels = ctx.reservedLabels.filter((label) => label.conn !== conn);
      if (best.rect) ctx.reservedLabels.push({ conn, rect: best.rect });
    }
  }

  // A bent route between nodes that overlap across the gap separating them
  // can run straight through facing sides inside that overlap.
  function straightenFacingRoutes() {
    for (const entry of resolvedRoutes) {
      const { conn } = entry;
      if (entry.points.length < 4 || fixed(conn)) continue;
      const { from, to } = ctx.endsOf(conn);
      const facing: Sides | null = from.x + from.width <= to.x ? { fromSide: 'right', toSide: 'left' }
        : to.x + to.width <= from.x ? { fromSide: 'left', toSide: 'right' }
          : from.y + from.height <= to.y ? { fromSide: 'bottom', toSide: 'top' }
            : to.y + to.height <= from.y ? { fromSide: 'top', toSide: 'bottom' } : null;
      if (!facing) continue;
      const axis = facing.fromSide === 'right' || facing.fromSide === 'left' ? 1 : 0;
      const [origin, size] = axis === 1 ? (['y', 'height'] as const) : (['x', 'width'] as const);
      const low = Math.max(from[origin], to[origin]) + AUTOMATIC_PORT_CORNER_GUTTER;
      const high = Math.min(from[origin] + from[size], to[origin] + to[size]) - AUTOMATIC_PORT_CORNER_GUTTER;
      if (high < low || (conn.fromSide && conn.fromSide !== facing.fromSide) || (conn.toSide && conn.toSide !== facing.toSide)) continue;
      const geometry = ctx.connectionGeometry(conn, facing);
      const { start, end } = geometry;
      const clamp = (value: number) => Math.min(high, Math.max(low, value));
      const others = resolvedRoutes.filter((other) => other !== entry);
      const otherLabels = ctx.reservedLabels.filter((label) => label.conn !== conn);
      const crossingsBefore = ctx.crossingCount(conn, entry.points, others);
      for (const lane of new Set([start[axis], end[axis], (start[axis] + end[axis]) / 2, (low + high) / 2].map(clamp))) {
        const points: Point[] = [[start[0], start[1]], [end[0], end[1]]];
        points[0][axis] = lane;
        points[1][axis] = lane;
        const routed = { conn, points, d: roundedPath(points, 8) };
        if (!points.every(withinScene)
          || !endpointSlotsClear([routed], others, sidesOf(conn, facing))
          || !ctx.routeIsClear(conn, routed, geometry, others)
          || ctx.crossingCount(conn, points, others) > crossingsBefore) continue;
        const rect = labelFor(conn, points, [...others.map((other) => other.points), points], otherLabels);
        if (!labelClears(rect, conn, others, otherLabels)) continue;
        ctx.cachePath(conn, { points, d: routed.d }, facing);
        entry.points = points;
        ctx.reservedLabels = [...otherLabels, ...(rect ? [{ conn, rect }] : [])];
        break;
      }
    }
  }

  // One more side sweep that may move a single blocking label, with no grid
  // search or cascading relayout.
  function relocateBlockingLabels() {
    for (const entry of resolvedRoutes) {
      const { conn } = entry;
      if (fixed(conn)) continue;
      const others = resolvedRoutes.filter((other) => other !== entry);
      if (entry.points.length <= 4 && ctx.crossingCount(conn, entry.points, others) === 0) continue;
      if (!labelRectFor || !ctx.reservedLabels.some((label) => label.conn !== conn)) continue;
      let best: { routed: Routed; sides: Sides; labels: ReservedLabel[] } | null = null;
      let bestCost = ctx.readabilityCost(conn, entry, others);
      for (const sides of ctx.candidateSidePairs(conn)) {
        const geometry = ctx.connectionGeometry(conn, sides);
        let routed: Routed;
        let clear: boolean;
        ctx.honourReservedLabels = false;
        try {
          routed = ctx.routedForGeometry(conn, others, geometry);
          clear = ctx.routeIsClear(conn, routed, geometry, others);
        } finally {
          ctx.honourReservedLabels = true;
        }
        const cost = ctx.readabilityCost(conn, routed, others);
        if (cost >= bestCost || !clear || !routed.points.every(withinScene)
          || ctx.crossingCount(conn, routed.points, others) > ctx.crossingCount(conn, entry.points, others)
          || !endpointSlotsClear([{ conn, points: routed.points }], others, sidesOf(conn, sides))) continue;
        const labels = relocatedLabelsFor(conn, routed, others);
        if (!labels) continue;
        best = { routed, sides, labels };
        bestCost = cost;
      }
      if (!best) continue;
      ctx.cachePath(conn, best.routed, best.sides);
      entry.points = best.routed.points;
      ctx.reservedLabels = best.labels;
    }
  }

  // A side's midpoint may be blocked even when a corner port has a clear
  // one-bend route: probe perpendicular side pairs, three slots per end.
  function probeCornerPorts() {
    const horizontal = (side: Side) => side === 'left' || side === 'right';
    const slots = (rect: Box, side: Side, preferred: Point) => {
      const axis = horizontal(side) ? 1 : 0;
      const origin = horizontal(side) ? rect.y : rect.x;
      const size = horizontal(side) ? rect.height : rect.width;
      const inset = Math.min(AUTOMATIC_PORT_CORNER_GUTTER, size / 2);
      return [...new Set([preferred[axis], origin + inset, origin + size - inset])].map((value) => {
        const point: Point = [preferred[0], preferred[1]];
        point[axis] = value;
        return point;
      }).filter((point) => portHasCornerClearance(rect, side, point));
    };
    for (const entry of resolvedRoutes) {
      const { conn } = entry;
      if (entry.points.length < 4 || fixed(conn)) continue;
      const others = resolvedRoutes.filter((other) => other !== entry);
      const labels = ctx.reservedLabels.filter((label) => label.conn !== conn);
      const crossingsBefore = ctx.crossingCount(conn, entry.points, others);
      let best: { routed: Routed; sides: Sides; rect: LabelRect | null } | null = null;
      let bestCost = ctx.readabilityCost(conn, entry, others);
      for (const sides of ctx.candidateSidePairs(conn)) {
        if (horizontal(sides.fromSide) === horizontal(sides.toSide)) continue;
        const geometry = ctx.connectionGeometry(conn, sides);
        for (const start of slots(geometry.from, sides.fromSide, geometry.start)) {
          for (const end of slots(geometry.to, sides.toSide, geometry.end)) {
            const corner: Point = horizontal(sides.fromSide) ? [end[0], start[1]] : [start[0], end[1]];
            const points = normalizeRoutePoints([start, corner, end]);
            const routed = { points, d: roundedPath(points, 8) };
            const cost = ctx.readabilityCost(conn, routed, others);
            if (cost >= bestCost || points.length !== 3 || !points.every(withinScene)
              || !endpointSlotsClear([{ conn, points }], others, sidesOf(conn, sides))
              || !ctx.routeIsClear(conn, routed, { ...geometry, start, end, crowded: false }, others)
              || ctx.crossingCount(conn, points, others) > crossingsBefore) continue;
            const rect = labelFor(conn, points, [...others.map((other) => other.points), points], labels);
            if (!labelClears(rect, conn, others, labels) || overlapsNode(rect)) continue;
            best = { routed, sides, rect };
            bestCost = cost;
          }
        }
      }
      if (!best) continue;
      ctx.cachePath(conn, best.routed, best.sides);
      entry.points = best.routed.points;
      ctx.reservedLabels = [...labels, ...(best.rect ? [{ conn, rect: best.rect }] : [])];
    }
  }

  improveReciprocalPairs();
  improveComplexRoutes();
  straightenFacingRoutes();
  relocateBlockingLabels();
  probeCornerPorts();
  // Only a remaining crossing can justify an extra lower corridor; a clear
  // scene must not grow merely because its labels could move there.
  if (ctx.readabilityBottomMargin > 0) {
    bounds.bottom += ctx.readabilityBottomMargin;
    improveComplexRoutes(true);
  }
}
