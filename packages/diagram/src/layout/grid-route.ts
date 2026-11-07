// Obstacle-avoiding orthogonal route search, ported from Archify (MIT,
// renderers/shared/route-quality.mjs): a bend-penalised shortest path over
// the grid of lines through every obstacle edge and route end.

import { normalizeRoutePoints, OUTWARD, properSegmentIntersection, segmentIntersectsRect, type Point, type Rect, type Segment } from './geometry.ts';
import type { Side } from '#model/schema.ts';

class MinHeap {
  entries: { key: string; distance: number }[] = [];

  push(key: string, distance: number) {
    const entry = { key, distance };
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.entries[parent].distance <= distance) break;
      this.entries[index] = this.entries[parent];
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop() {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (last === undefined || !this.entries.length) return first;
    let index = 0;
    while (index * 2 + 1 < this.entries.length) {
      const left = index * 2 + 1;
      const right = left + 1;
      const child = right < this.entries.length && this.entries[right].distance < this.entries[left].distance ? right : left;
      if (this.entries[child].distance >= last.distance) break;
      this.entries[index] = this.entries[child];
      index = child;
    }
    this.entries[index] = last;
    return first;
  }
}

function moveOutward(point: Point, side: Side, distance: number): Point {
  const [dx, dy] = OUTWARD[side];
  return [point[0] + dx * distance, point[1] + dy * distance];
}

function expandedRect(rect: Rect, clearance: number): Rect {
  return { x: rect.x - clearance, y: rect.y - clearance, width: rect.width + clearance * 2, height: rect.height + clearance * 2 };
}

function pointBlocked(point: Point, obstacles: readonly Rect[]) {
  return obstacles.some((rect) => point[0] >= rect.x && point[0] <= rect.x + rect.width
    && point[1] >= rect.y && point[1] <= rect.y + rect.height);
}

function pointOnSegmentInterior(point: Point, start: Point, end: Point) {
  const epsilon = 0.0001;
  const cross = (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0]);
  if (Math.abs(cross) > epsilon) return false;
  const dot = (point[0] - start[0]) * (point[0] - end[0]) + (point[1] - start[1]) * (point[1] - end[1]);
  return dot < -epsilon;
}

const pointKey = (point: Point) => `${String(point[0])}\u0000${String(point[1])}`;

function segmentBlocked(start: Point, end: Point, obstacles: readonly Rect[]) {
  const minX = Math.min(start[0], end[0]);
  const maxX = Math.max(start[0], end[0]);
  const minY = Math.min(start[1], end[1]);
  const maxY = Math.max(start[1], end[1]);
  return obstacles.some((rect) => {
    if (maxX < Math.min(rect.x, rect.x + rect.width) - 0.0001
      || minX > Math.max(rect.x, rect.x + rect.width) + 0.0001
      || maxY < Math.min(rect.y, rect.y + rect.height) - 0.0001
      || minY > Math.max(rect.y, rect.y + rect.height) + 0.0001) return false;
    return segmentIntersectsRect({ start, end }, rect);
  });
}

export function orthogonalTouchOnInterior(start: Point, end: Point, otherStart: Point, otherEnd: Point) {
  const epsilon = 0.0001;
  const candidateHorizontal = Math.abs(start[1] - end[1]) <= epsilon;
  const candidateVertical = Math.abs(start[0] - end[0]) <= epsilon;
  const otherHorizontal = Math.abs(otherStart[1] - otherEnd[1]) <= epsilon;
  const otherVertical = Math.abs(otherStart[0] - otherEnd[0]) <= epsilon;
  if (candidateHorizontal && otherVertical) {
    const x = otherStart[0];
    const y = start[1];
    return x >= Math.min(start[0], end[0]) - epsilon && x <= Math.max(start[0], end[0]) + epsilon
      && y > Math.min(otherStart[1], otherEnd[1]) + epsilon && y < Math.max(otherStart[1], otherEnd[1]) - epsilon;
  }
  if (candidateVertical && otherHorizontal) {
    const x = start[0];
    const y = otherStart[1];
    return y >= Math.min(start[1], end[1]) - epsilon && y <= Math.max(start[1], end[1]) + epsilon
      && x > Math.min(otherStart[0], otherEnd[0]) + epsilon && x < Math.max(otherStart[0], otherEnd[0]) - epsilon;
  }
  return false;
}

function collinearOverlap(leftStart: Point, leftEnd: Point, rightStart: Point, rightEnd: Point) {
  if (leftStart[0] === leftEnd[0] && rightStart[0] === rightEnd[0] && leftStart[0] === rightStart[0]) {
    return Math.max(0, Math.min(Math.max(leftStart[1], leftEnd[1]), Math.max(rightStart[1], rightEnd[1]))
      - Math.max(Math.min(leftStart[1], leftEnd[1]), Math.min(rightStart[1], rightEnd[1])));
  }
  if (leftStart[1] === leftEnd[1] && rightStart[1] === rightEnd[1] && leftStart[1] === rightStart[1]) {
    return Math.max(0, Math.min(Math.max(leftStart[0], leftEnd[0]), Math.max(rightStart[0], rightEnd[0]))
      - Math.max(Math.min(leftStart[0], leftEnd[0]), Math.min(rightStart[0], rightEnd[0])));
  }
  return 0;
}

function segmentConflictsWithAvoided(start: Point, end: Point, avoided: readonly Segment[], minimumOverlapPx: number, allowCrossings: boolean) {
  const minX = Math.min(start[0], end[0]);
  const maxX = Math.max(start[0], end[0]);
  const minY = Math.min(start[1], end[1]);
  const maxY = Math.max(start[1], end[1]);
  return avoided.some((segment) => {
    // A zero overlap threshold also rejects disjoint segments (0 >= 0).
    if (minimumOverlapPx > 0 && (maxX < Math.min(segment.start[0], segment.end[0]) - 0.0001
      || minX > Math.max(segment.start[0], segment.end[0]) + 0.0001
      || maxY < Math.min(segment.start[1], segment.end[1]) - 0.0001
      || minY > Math.max(segment.start[1], segment.end[1]) + 0.0001)) return false;
    return (!allowCrossings && (properSegmentIntersection(start, end, segment.start, segment.end) !== null
      || orthogonalTouchOnInterior(start, end, segment.start, segment.end)))
      || collinearOverlap(start, end, segment.start, segment.end) >= minimumOverlapPx;
  });
}

export type GridRouteOptions = {
  start: Point;
  end: Point;
  obstacles: readonly Rect[];
  fromSide: Side;
  toSide: Side;
  clearance: number;
  maximumObstacleCount: number;
  endpointStubPx: number;
  maximumGridNodes: number;
  // Other routes' segments: never followed, crossed only when allowed.
  avoidedSegments: readonly Segment[];
  allowAvoidedCrossings: boolean;
  minimumAvoidedOverlapPx: number;
  routeSeparationPx: number;
  minimumSegmentPx: number;
  // Frame borders: crossed, never followed.
  borderSegments: readonly Segment[];
  bendPenaltyPx: number;
}

export function shortestOrthogonalGridRoute({
  start, end, obstacles, fromSide, toSide, clearance, maximumObstacleCount, endpointStubPx, maximumGridNodes,
  avoidedSegments, allowAvoidedCrossings, minimumAvoidedOverlapPx, routeSeparationPx, minimumSegmentPx,
  borderSegments, bendPenaltyPx,
}: GridRouteOptions): Point[] | null {
  const startStub = moveOutward(start, fromSide, endpointStubPx);
  const endStub = moveOutward(end, toSide, endpointStubPx);
  const expanded = obstacles.map((rect) => expandedRect(rect, clearance));
  if (expanded.length > maximumObstacleCount) return null;

  const xs = new Set([startStub[0], endStub[0], start[0], end[0]]);
  const ys = new Set([startStub[1], endStub[1], start[1], end[1]]);
  for (const rect of expanded) {
    xs.add(rect.x - 1);
    xs.add(rect.x + rect.width + 1);
    ys.add(rect.y - 1);
    ys.add(rect.y + rect.height + 1);
  }
  for (const { start: segmentStart, end: segmentEnd } of avoidedSegments) {
    xs.add(segmentStart[0]);
    xs.add(segmentEnd[0]);
    ys.add(segmentStart[1]);
    ys.add(segmentEnd[1]);
    if (Math.abs(segmentStart[0] - segmentEnd[0]) <= 0.0001) {
      xs.add(segmentStart[0] - routeSeparationPx);
      xs.add(segmentStart[0] + routeSeparationPx);
    }
    if (Math.abs(segmentStart[1] - segmentEnd[1]) <= 0.0001) {
      ys.add(segmentStart[1] - routeSeparationPx);
      ys.add(segmentStart[1] + routeSeparationPx);
    }
  }
  const addBorderCoordinates = (distance: number) => {
    for (const segment of borderSegments) {
      if (Math.abs(segment.start[0] - segment.end[0]) <= 0.0001) {
        xs.add(segment.start[0] - distance);
        xs.add(segment.start[0] + distance);
      }
      if (Math.abs(segment.start[1] - segment.end[1]) <= 0.0001) {
        ys.add(segment.start[1] - distance);
        ys.add(segment.start[1] + distance);
      }
    }
  };
  addBorderCoordinates(routeSeparationPx);
  // Grid lines closer than a readable segment would let the search emit a
  // micro jog between two obstacle edges; keep the endpoint stubs and coalesce
  // the rest so every turn the route can take is at least one segment long.
  const coalesce = (values: number[], keep: Set<number>, fillGaps: boolean) => {
    const sorted = values.sort((a, b) => a - b);
    if (!fillGaps) {
      return sorted.filter((value, index) => index === 0 || keep.has(value) || value - sorted[index - 1] >= minimumSegmentPx);
    }
    return sorted.reduce<number[]>((retained, value) => {
      if (keep.has(value) || ((!retained.length || value - retained[retained.length - 1] >= minimumSegmentPx)
        && [...keep].every((endpoint) => Math.abs(value - endpoint) >= minimumSegmentPx))) retained.push(value);
      return retained;
    }, []);
  };
  // A failed search can retry on the denser coordinate set, within the same node budget.
  let remainingGridNodes = maximumGridNodes;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0 && routeSeparationPx < minimumSegmentPx) addBorderCoordinates(minimumSegmentPx);
    const orderedX = coalesce([...xs], new Set([startStub[0], endStub[0]]), attempt > 0);
    const orderedY = coalesce([...ys], new Set([startStub[1], endStub[1]]), attempt > 0);
    const candidateNodeCount = orderedX.length * orderedY.length;
    if (candidateNodeCount > remainingGridNodes) return null;
    remainingGridNodes -= candidateNodeCount;
    const nodes = new Map<string, Point>();
    for (const x of orderedX) {
      for (const y of orderedY) {
        const point: Point = [x, y];
        if (!pointBlocked(point, expanded)
          && (allowAvoidedCrossings || !avoidedSegments.some((segment) => pointOnSegmentInterior(point, segment.start, segment.end)))) {
          nodes.set(pointKey(point), point);
        }
      }
    }
    if (!nodes.has(pointKey(startStub)) || !nodes.has(pointKey(endStub))) return null;

    type Direction = 'R' | 'L' | 'D' | 'U';
    const adjacency = new Map<string, [string, number, Direction][]>();
    const link = (from: Point, to: Point, distance: number, direction: Direction) => {
      const links = adjacency.get(pointKey(from)) ?? [];
      links.push([pointKey(to), distance, direction]);
      adjacency.set(pointKey(from), links);
    };
    const connectLine = (line: Point[], horizontal: boolean) => {
      for (let index = 0; index < line.length - 1; index += 1) {
        const left = line[index];
        const right = line[index + 1];
        if (segmentBlocked(left, right, expanded)) continue;
        if (segmentConflictsWithAvoided(left, right, avoidedSegments, minimumAvoidedOverlapPx, allowAvoidedCrossings)) continue;
        if (borderSegments.some((segment) => collinearOverlap(left, right, segment.start, segment.end) > 0.0001)) continue;
        const distance = Math.abs(right[0] - left[0]) + Math.abs(right[1] - left[1]);
        link(left, right, distance, horizontal ? 'R' : 'D');
        link(right, left, distance, horizontal ? 'L' : 'U');
      }
    };
    for (const y of orderedY) connectLine(orderedX.map((x) => nodes.get(pointKey([x, y]))).filter((point) => point !== undefined), true);
    for (const x of orderedX) connectLine(orderedY.map((y) => nodes.get(pointKey([x, y]))).filter((point) => point !== undefined), false);

    // The search state carries the incoming direction so a turn can cost
    // extra and a reversal is never taken.
    const directionOf = ([dx, dy]: Point): Direction => (dx > 0 ? 'R' : dx < 0 ? 'L' : dy > 0 ? 'D' : 'U');
    const opposite: Record<Direction, Direction> = { R: 'L', L: 'R', D: 'U', U: 'D' };
    const stateKey = (key: string, direction: Direction) => `${key}|${direction}`;
    const sourceAxis = directionOf(OUTWARD[fromSide]);
    const targetAxis = opposite[directionOf(OUTWARD[toSide])];
    const source = pointKey(startStub);
    const target = pointKey(endStub);
    const sourceState = stateKey(source, sourceAxis);
    const distances = new Map([[sourceState, 0]]);
    const previous = new Map<string, string>();
    const queue = new MinHeap();
    queue.push(sourceState, 0);
    let targetState: { key: string; distance: number } | null = null;
    while (queue.entries.length) {
      const { key: current, distance: currentDistance } = queue.pop();
      if (currentDistance !== distances.get(current)) continue;
      const [currentNode, currentAxis] = current.split('|') as [string, Direction];
      if (currentNode === target) {
        // The end stub is outside the graph: never reverse back onto it.
        if (currentAxis === opposite[targetAxis]) continue;
        const arrival = currentDistance + (currentAxis === targetAxis ? 0 : bendPenaltyPx);
        if (targetState == null || arrival < targetState.distance) targetState = { key: current, distance: arrival };
        if (currentAxis === targetAxis || bendPenaltyPx === 0) break;
        continue;
      }
      if (targetState && currentDistance >= targetState.distance) break;
      for (const [neighbor, weight, axis] of adjacency.get(currentNode) ?? []) {
        if (axis === opposite[currentAxis]) continue;
        const candidate = currentDistance + weight + (axis === currentAxis ? 0 : bendPenaltyPx);
        const neighborState = stateKey(neighbor, axis);
        if (candidate >= (distances.get(neighborState) ?? Infinity)) continue;
        distances.set(neighborState, candidate);
        previous.set(neighborState, current);
        queue.push(neighborState, candidate);
      }
    }
    if (!targetState) continue;
    const reversed: Point[] = [];
    for (let key: string | undefined = targetState.key; key; key = previous.get(key)) {
      const node = nodes.get(key.split('|')[0]);
      if (!node) throw new Error('a search state names a point outside the graph');
      reversed.push(node);
      if (key === sourceState) break;
    }
    if (pointKey(reversed[reversed.length - 1]) !== source) return null;
    return normalizeRoutePoints([start, ...reversed.reverse(), end]);
  }
  return null;
}
