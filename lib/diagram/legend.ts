// The kind legend under a diagram, measured as Archify does (MIT,
// renderers/shared/legend.mjs): one swatch and name per kind in use, in the
// order the diagram lists its kinds, wrapped into rows, the "Legend" title
// above them.

import { rectsOverlap, segmentIntersectsRect, textUnits, type Rect, type Segment } from './geometry.ts';
import type { Diagram, Tone } from './schema.ts';

const FONT_SIZE = 8;
const ITEM_GAP = 22;
const LINE_GAP = 22;
const SWATCH_WIDTH = 14;
const SWATCH_GAP = 8;
const TEXT_ADVANCE_EM = 0.62;
// Archify reserves room for the count badge its legend shows on present kinds.
const INTERACTIVE_BADGE_ALLOWANCE = 21;

export interface LegendEntry {
  kind: string;
  tone: Tone;
  label: string;
  // How many nodes have this kind.
  count: number;
  width: number;
}

export interface PlacedLegendEntry extends LegendEntry {
  x: number;
  baseline: number;
}

export interface SceneLegend {
  x: number;
  titleY: number;
  // The rendered label size: the measuring size plus 2.
  fontSize: number;
  entries: PlacedLegendEntry[];
}

export const legendTextSize = (fontSize = FONT_SIZE) => (fontSize < 8 ? fontSize + 0.5 : fontSize + 2);
export const LEGEND_SWATCH_OFFSET = SWATCH_WIDTH + SWATCH_GAP;

// The kinds in use, in the diagram's order.
export function legendEntries(diagram: Diagram): LegendEntry[] {
  if (!diagram.legend) return [];
  const counts = new Map<string, number>();
  for (const node of diagram.nodes) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
  return diagram.kinds.filter((kind) => counts.has(kind.id)).map(({ id, label, tone }) => {
    const width = Math.ceil(SWATCH_WIDTH + SWATCH_GAP + textUnits(label) * legendTextSize() * TEXT_ADVANCE_EM + INTERACTIVE_BADGE_ALLOWANCE);
    return { kind: id, tone, label, count: counts.get(id)!, width };
  });
}

export function legendFootprint(entries: readonly LegendEntry[], width: number) {
  if (!entries.length) return { rows: [] as LegendEntry[][], minWidth: 0, extraHeight: 0 };
  const rows: LegendEntry[][] = [[]];
  let cursor = 0;
  for (const entry of entries) {
    const row = rows[rows.length - 1];
    const required = (row.length ? ITEM_GAP : 0) + entry.width;
    if (row.length && cursor + required > width) {
      rows.push([entry]);
      cursor = entry.width;
    } else {
      row.push(entry);
      cursor += required;
    }
  }
  return {
    rows,
    minWidth: entries.reduce((max, entry) => Math.max(max, entry.width), 0),
    extraHeight: (rows.length - 1) * LINE_GAP,
  };
}

// Lays the legend out on its band; null when it does not fit there: an
// entry wider than the band, rows that climb into the content, or an entry
// on top of a route or an edge label.
export function placeLegend(entries: readonly LegendEntry[], { x, baselineY, width, minTitleY, obstacles }: {
  x: number;
  baselineY: number;
  width: number;
  minTitleY: number;
  obstacles: readonly (Rect | Segment)[];
}): SceneLegend | null {
  if (!entries.length) return null;
  const footprint = legendFootprint(entries, width);
  if (entries.some((entry) => entry.width > width)) return null;
  const titleY = baselineY - footprint.extraHeight - 20;
  if (titleY - 10 < minTitleY) return null;
  const placed: PlacedLegendEntry[] = [];
  footprint.rows.forEach((row, rowIndex) => {
    let entryX = x;
    const baseline = baselineY - (footprint.rows.length - rowIndex - 1) * LINE_GAP;
    for (const entry of row) {
      placed.push({ ...entry, x: entryX, baseline });
      entryX += entry.width + ITEM_GAP;
    }
  });
  const rects: Rect[] = [
    { x, y: titleY - 10, width: 48, height: 14 },
    ...placed.map((entry) => ({ x: entry.x, y: entry.baseline - 10, width: entry.width, height: 14 })),
  ];
  const collides = rects.some((rect) => obstacles.some((obstacle) => ('start' in obstacle
    ? segmentIntersectsRect(obstacle, rect)
    : rectsOverlap(obstacle, rect))));
  if (collides) return null;
  return { x, titleY, fontSize: legendTextSize(), entries: placed };
}
