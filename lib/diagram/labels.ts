// Edge label placement, ported from Archify (MIT,
// renderers/shared/automatic-labels.mjs and spatial-grid.mjs): a label that
// overlaps a node, a frame title, another label or another route moves to the
// nearest clear spot beside its own route.

import { normalizeRoutePoints, rectsOverlap, segmentRectClearanceWithin, type Point, type Rect } from './geometry.ts';

export interface LabelRect extends Rect {
  // The label's anchor: the text is centred on `lx`, its baseline at `ly`.
  lx: number;
  ly: number;
  relationIndex: number;
  // An author-placed label (labelAt / labelDx / labelDy) never moves.
  pinned?: boolean;
}

export interface LabelRoute {
  relationIndex: number;
  points: readonly Point[];
}

interface IndexedSegment {
  relationIndex: number;
  start: Point;
  end: Point;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function createSpatialGrid<T>(cellSize: number, maxCells = 4096) {
  const buckets = new Map<string, T[]>();
  const items: T[] = [];
  // Items whose own box cannot be walked are candidates for every query.
  const overflow: T[] = [];
  const keyOf = (x: number, y: number) => `${x}:${y}`;
  const rangeOf = (box: Bounds) => ({
    x0: Math.floor(box.minX / cellSize), x1: Math.floor(box.maxX / cellSize),
    y0: Math.floor(box.minY / cellSize), y1: Math.floor(box.maxY / cellSize),
  });
  const walkable = (range: ReturnType<typeof rangeOf>) => Number.isSafeInteger(range.x0) && Number.isSafeInteger(range.x1)
    && Number.isSafeInteger(range.y0) && Number.isSafeInteger(range.y1)
    && (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1) <= maxCells;
  return {
    insert(box: Bounds, item: T) {
      items.push(item);
      const range = rangeOf(box);
      if (!walkable(range)) {
        overflow.push(item);
        return;
      }
      for (let x = range.x0; x <= range.x1; x += 1) {
        for (let y = range.y0; y <= range.y1; y += 1) {
          const key = keyOf(x, y);
          const bucket = buckets.get(key);
          if (bucket) bucket.push(item);
          else buckets.set(key, [item]);
        }
      }
    },
    query(box: Bounds): T[] {
      const range = rangeOf(box);
      if (!walkable(range)) return items.slice();
      const seen = new Set<T>();
      for (let x = range.x0; x <= range.x1; x += 1) {
        for (let y = range.y0; y <= range.y1; y += 1) {
          for (const item of buckets.get(keyOf(x, y)) ?? []) seen.add(item);
        }
      }
      for (const item of overflow) seen.add(item);
      return [...seen];
    },
  };
}

export interface PlaceLabelsOptions {
  labels: LabelRect[];
  routes: readonly LabelRoute[];
  components: readonly Rect[];
  titles: readonly Rect[];
  viewBox: readonly [number, number];
  placementBottom?: number;
  fallbackRing?: boolean;
  keepFallbackNearRoute?: boolean;
}

export function placeAutomaticLabels({
  labels, routes, components, titles, viewBox, placementBottom = viewBox[1], fallbackRing = true, keepFallbackNearRoute = false,
}: PlaceLabelsOptions): LabelRect[] {
  const placed = [...labels];
  const obstacles = [...components, ...titles];
  const segments: IndexedSegment[] = routes.flatMap(({ relationIndex, points }) => {
    const normalized = normalizeRoutePoints(points);
    return normalized.slice(1).map((end, index) => ({ relationIndex, start: normalized[index], end }));
  });
  const inside = (rect: Rect) => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewBox[0] && rect.y + rect.height <= viewBox[1];
  const segmentGrid = createSpatialGrid<IndexedSegment>(120);
  for (const segment of segments) {
    const [sx, sy] = segment.start;
    const [ex, ey] = segment.end;
    segmentGrid.insert({ minX: Math.min(sx, ex), maxX: Math.max(sx, ex), minY: Math.min(sy, ey), maxY: Math.max(sy, ey) }, segment);
  }
  const segmentsNear = (rect: Rect, margin: number) => segmentGrid.query({
    minX: rect.x - margin, maxX: rect.x + rect.width + margin, minY: rect.y - margin, maxY: rect.y + rect.height + margin,
  });
  const masksRoute = (rect: LabelRect) => {
    for (const segment of segmentsNear(rect, 4)) {
      if (segment.relationIndex === rect.relationIndex) continue;
      if (segmentRectClearanceWithin(segment, rect, 4) + 0.0001 < 4) return true;
    }
    return false;
  };
  const overlapsLabel = (rect: Rect, index: number, gap = 0) => placed.some((other, otherIndex) => otherIndex !== index && rectsOverlap(rect, other, gap));
  const clear = (rect: LabelRect, index: number) => inside(rect) && rect.y + rect.height <= placementBottom
    && !obstacles.some((obstacle) => rectsOverlap(rect, obstacle, 2))
    && !overlapsLabel(rect, index, 2) && !masksRoute(rect);
  const rectAt = (label: LabelRect, lx: number, ly: number): LabelRect => ({ ...label, lx, ly, x: lx - label.width / 2, y: ly - 10 });

  // Fixed fractions can miss a narrow free slot. Try the ends of the free
  // intervals beside an orthogonal segment, using obstacle edges rather than a
  // finer sampling grid.
  const slidingCandidates = (label: LabelRect, index: number, { start: a, end: b }: IndexedSegment) => {
    const horizontal = Math.abs(a[1] - b[1]) < 0.0001;
    if (!horizontal && Math.abs(a[0] - b[0]) >= 0.0001) return [];
    const axis = horizontal ? 'x' : 'y';
    const size = horizontal ? 'width' : 'height';
    const across = horizontal ? 'y' : 'x';
    const crossSize = horizontal ? 'height' : 'width';
    const low = Math.min(a[horizontal ? 0 : 1], b[horizontal ? 0 : 1]) + 8;
    const high = Math.max(a[horizontal ? 0 : 1], b[horizontal ? 0 : 1]) - label[size] - 8;
    if (high < low) return [];
    const offsets = horizontal
      ? [a[1] - 20, a[1] + 10, a[1] - 28, a[1] + 18]
      : [a[0] - label.width - 6, a[0] + 6, a[0] - label.width - 14, a[0] + 14];
    return offsets.flatMap((offset) => {
      const band = { ...label, [axis]: low, [size]: high - low + label[size], [across]: offset };
      const blockers = [
        ...obstacles.map((rect) => ({ rect, gap: 2 })),
        ...placed.filter((_, otherIndex) => otherIndex !== index).map((rect) => ({ rect, gap: 2 })),
        ...segmentsNear(band, 4).filter((segment) => segment.relationIndex !== label.relationIndex).map((segment) => ({
          rect: {
            x: Math.min(segment.start[0], segment.end[0]), y: Math.min(segment.start[1], segment.end[1]),
            width: Math.abs(segment.end[0] - segment.start[0]), height: Math.abs(segment.end[1] - segment.start[1]),
          },
          gap: 4,
        })),
      ];
      const positions = [Math.max(low, Math.min(high, label[axis])), low, high];
      for (const { rect, gap } of blockers) {
        if (offset + label[crossSize] + gap <= rect[across] || rect[across] + rect[crossSize] + gap <= offset) continue;
        positions.push(rect[axis] - gap - label[size], rect[axis] + rect[size] + gap);
      }
      return [...new Set(positions)].filter((position) => position >= low && position <= high)
        .sort((left, right) => Math.abs(left - label[axis]) - Math.abs(right - label[axis]))
        .map((position) => {
          const rect = { ...label, [axis]: position, [across]: offset };
          return rectAt(label, rect.x + label.width / 2, rect.y + 10);
        });
    });
  };

  const needsPlacement = (label: LabelRect, index: number) => !inside(label)
    || components.some((component) => rectsOverlap(label, component, -2))
    || titles.some((title) => rectsOverlap(label, title))
    || overlapsLabel(label, index) || masksRoute(label);
  const placeLabel = (index: number) => {
    const label = placed[index];
    // A valid placement is not a reason to restyle the diagram.
    if (!needsPlacement(label, index)) return;
    for (const segment of segments.filter((candidate) => candidate.relationIndex === label.relationIndex)) {
      const [a, b] = [segment.start, segment.end];
      let candidates: Point[] = [];
      if (Math.abs(a[1] - b[1]) < 0.0001 && Math.abs(a[0] - b[0]) >= label.width + 4) {
        candidates = [0.5, 0.25, 0.75, 0.125, 0.875].flatMap((fraction): Point[] => {
          const x = a[0] + (b[0] - a[0]) * fraction;
          if (Math.min(Math.abs(x - a[0]), Math.abs(x - b[0])) < 8) return [];
          return [[x, a[1] - 10], [x, a[1] + 20], [x, a[1] - 18], [x, a[1] + 28]];
        });
      } else if (Math.abs(a[0] - b[0]) < 0.0001 && Math.abs(a[1] - b[1]) >= label.height + 16) {
        candidates = [0.5, 0.25, 0.75, 0.125, 0.875].flatMap((fraction): Point[] => {
          const y = a[1] + (b[1] - a[1]) * fraction;
          if (Math.min(Math.abs(y - a[1]), Math.abs(y - b[1])) < 8) return [];
          return [
            [a[0] - label.width / 2 - 6, y + 3],
            [a[0] + label.width / 2 + 6, y + 3],
            [a[0] - label.width / 2 - 14, y + 3],
            [a[0] + label.width / 2 + 14, y + 3],
          ];
        });
      }
      const replacement = candidates.map(([lx, ly]) => rectAt(label, lx, ly)).find((rect) => clear(rect, index));
      if (replacement) {
        placed[index] = replacement;
        break;
      }
    }
    if (placed[index] !== label) return;
    const sliding = segments.filter((segment) => segment.relationIndex === label.relationIndex)
      .flatMap((segment) => slidingCandidates(label, index, segment)).find((rect) => clear(rect, index));
    if (sliding) {
      placed[index] = sliding;
      return;
    }
    if (!fallbackRing) return;

    // Dense but valid topologies can leave every point directly beside the
    // relationship occupied by another route. Search a small deterministic
    // ring around the current anchor and the relationship's segment centres.
    const ownSegments = segments.filter((segment) => segment.relationIndex === label.relationIndex);
    const baseAnchors: Point[] = [
      [label.lx, label.ly],
      ...ownSegments.map((segment): Point => [(segment.start[0] + segment.end[0]) / 2, (segment.start[1] + segment.end[1]) / 2]),
    ];
    const horizontalStep = label.width / 2 + 12;
    const ringOffsets: Point[] = [
      [0, -28], [0, 38],
      [-horizontalStep, -28], [horizontalStep, -28],
      [-horizontalStep, 38], [horizontalStep, 38],
      [-(label.width + 20), -52], [label.width + 20, -52],
      [-(label.width + 20), 62], [label.width + 20, 62],
      [-(label.width + 20), -76], [label.width + 20, -76],
      [-(label.width + 20), 86], [label.width + 20, 86],
    ];
    const fallback = baseAnchors.flatMap(([baseX, baseY]) => ringOffsets.map(([dx, dy]) => rectAt(label, baseX + dx, baseY + dy)))
      .find((rect) => clear(rect, index) && (!keepFallbackNearRoute
        || ownSegments.some((segment) => segmentRectClearanceWithin(segment, rect, label.height * 2) <= label.height * 2)));
    if (fallback) placed[index] = fallback;
  };
  let pending = placed.map((_, index) => index).filter((index) => !placed[index].pinned);
  // A later label can vacate the only slot available to an earlier one: retry
  // only unresolved labels after a move, at most one pass per label.
  for (let pass = 0; pass < labels.length && pending.length; pass += 1) {
    let moved = false;
    for (const index of pending) {
      const before = placed[index];
      placeLabel(index);
      moved ||= placed[index] !== before;
    }
    if (!moved) break;
    pending = pending.filter((index) => needsPlacement(placed[index], index));
  }
  return placed;
}

// Where a just-routed edge's label would go given the routes and labels
// placed so far; null when it can only overlap a node.
export function reservedLabelRect({ label, points, routes, labels, components }: {
  label: LabelRect;
  points: readonly Point[];
  routes: readonly LabelRoute[];
  labels: readonly LabelRect[];
  components: readonly Rect[];
}): LabelRect | null {
  const [rect] = placeAutomaticLabels({
    labels: [{ ...label, relationIndex: -1 }, ...labels.map((other) => ({ ...other, relationIndex: -2 }))],
    routes: [{ relationIndex: -1, points }, ...routes],
    components,
    titles: [],
    viewBox: [Infinity, Infinity],
    placementBottom: Infinity,
    fallbackRing: false,
  });
  return components.some((component) => rectsOverlap(rect, component, -2)) ? null : rect;
}
