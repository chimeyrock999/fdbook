// Archify's own layout of an architecture spec, as tests/fixtures/archify
// keeps it: the canvas, each boundary frame, and each connection's route and
// label anchor from a `render-architecture.mjs --layout-json` report. The
// parity test (tests/diagram-archify.test.ts) holds the port to these, and
// scripts/archify-fixtures.ts writes them from a given Archify.

type Pair = [number, number];

export interface LayoutFixture {
  source: string;
  viewBox: Pair;
  boundaries: [number, number, number, number][];
  connections: { points: Pair[]; labelAt?: Pair }[];
}

// The report's fields a fixture keeps; it carries more (components, labels,
// each connection's ends and variant).
export interface LayoutReport {
  ok?: boolean;
  diagram_type?: string;
  viewBox: Pair;
  boundaries?: { x: number; y: number; width: number; height: number; [field: string]: unknown }[];
  connections?: { points: Pair[]; labelAt?: Pair; [field: string]: unknown }[];
  [field: string]: unknown;
}

export function layoutFixtureOf(report: LayoutReport, source: string): LayoutFixture {
  if (report.ok !== true) throw new Error('the layout report is not ok');
  if (report.diagram_type !== 'architecture') throw new Error(`expected an architecture report, got ${report.diagram_type}`);
  return {
    source,
    viewBox: report.viewBox,
    boundaries: (report.boundaries ?? []).map(({ x, y, width, height }) => [x, y, width, height]),
    connections: (report.connections ?? []).map(({ points, labelAt }) => (labelAt ? { points, labelAt } : { points })),
  };
}

// A number array stays on one line, so a moved route reads as a one-line
// diff; a list of them longer than a line gets one item per line.
const LINE = 120;
const inline = (value: unknown) => JSON.stringify(value).replaceAll(',', ', ');

function field(indent: string, key: string, value: unknown[]) {
  const line = `${indent}${JSON.stringify(key)}: ${inline(value)}`;
  if (line.length + 1 <= LINE) return line;
  return [`${indent}${JSON.stringify(key)}: [`, value.map((item) => `${indent}  ${inline(item)}`).join(',\n'), `${indent}]`].join('\n');
}

export function formatLayoutFixture(fixture: LayoutFixture) {
  const connections = fixture.connections.map((connection) => [
    '    {',
    [field('      ', 'points', connection.points), ...(connection.labelAt ? [field('      ', 'labelAt', connection.labelAt)] : [])].join(',\n'),
    '    }',
  ].join('\n'));
  return [
    '{',
    `  "source": ${JSON.stringify(fixture.source)},`,
    `${field('  ', 'viewBox', fixture.viewBox)},`,
    `${field('  ', 'boundaries', fixture.boundaries)},`,
    ...(connections.length ? ['  "connections": [', connections.join(',\n'), '  ]'] : ['  "connections": []']),
    '}',
    '',
  ].join('\n');
}

// What the parity test compares: routes to the hundredth of a pixel, label
// anchors to the whole pixel, as tests/diagram-archify.test.ts rounds them.
function placement({ viewBox, boundaries, connections }: LayoutFixture) {
  const round = (value: number, step: number) => Math.round(value * step) / step;
  return JSON.stringify([
    viewBox,
    boundaries,
    connections.map(({ points, labelAt }) => [points.map((point) => point.map((value) => round(value, 100))), labelAt?.map((value) => round(value, 1)) ?? null]),
  ]);
}

// Whether two fixtures place everything alike, whichever Archify made them.
export function sameLayout(a: LayoutFixture, b: LayoutFixture) {
  return placement(a) === placement(b);
}
