// Archify's drawing of a lifecycle, as tests/fixtures/archify keeps it: the
// canvas, state boxes, every transition's route, label plates, composite
// frames and bus junctions, read off the SVG `render-lifecycle.mjs` writes
// (it has no --layout-json). The legend is left out: the spec Archify draws
// hides it (archify-lifecycle.ts), and the scene compared is drawn without one.

import { formatDiagramJson } from '#model/format.ts';
import type { Scene } from '#layout/scene.ts';

type Box = [number, number, number, number];
type Pair = [number, number];

export type LifecycleLayoutFixture = {
  source: string;
  diagram_type: 'lifecycle';
  viewBox: Pair;
  states: Box[];
  routes: Pair[][];
  // [transition index, x, y, width, height]
  labels: [number, number, number, number, number][];
  frames: Box[];
  junctions: Pair[];
}

const round = (value: number) => Math.round(value * 100) / 100;
const attr = (tag: string, name: string) => {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  if (!match) throw new Error(`no ${name} in ${tag.slice(0, 120)}`);
  return match[1];
};
const box = (tag: string): Box => [Number(attr(tag, 'x')), Number(attr(tag, 'y')), Number(attr(tag, 'width')), Number(attr(tag, 'height'))].map(round) as Box;

export function lifecycleFixtureOf(html: string, source: string): LifecycleLayoutFixture {
  const svg = html.slice(html.indexOf('<svg viewBox'), html.indexOf('</svg>'));
  // Archify marks each part of the drawing with a comment; one missing means
  // the drawing changed shape, and the fixture must not be guessed.
  const section = (name: string, next: string) => {
    const start = svg.indexOf(`<!-- ${name} -->`);
    const end = svg.indexOf(`<!-- ${next} -->`);
    if (start < 0 || end < start) throw new Error(`Archify's drawing has no "${name}" part before "${next}"; read its SVG again`);
    return svg.slice(start, end);
  };
  const [, , width, height] = attr(svg.slice(0, svg.indexOf('>')), 'viewBox').split(/\s+/).map(Number);
  return {
    source,
    diagram_type: 'lifecycle',
    viewBox: [width, height],
    states: [...section('States', 'Transition labels').matchAll(/<g [^>]*data-node-id="[^"]*"[^>]*>\s*<title>[^<]*<\/title>\s*(<rect [^>]*>)/g)].map((match) => box(match[1])),
    routes: [...section('Transition paths', 'States').matchAll(/data-composition-points="([^"]*)"/g)]
      .map((match) => match[1].split(';').map((point) => point.split(',').map((value) => round(Number(value))) as Pair)),
    labels: [...section('Transition labels', 'Legend').matchAll(/<g [^>]*data-edge-key="(\d+)"[^>]*>\s*(<rect [^>]*>)/g)]
      .map((match) => [Number(match[1]), ...box(match[2])] as [number, number, number, number, number]),
    frames: [...section('Composite phases', 'Transition paths').matchAll(/<rect [^>]*data-lifecycle-frame=""[^>]*>/g)].map((match) => box(match[0])),
    junctions: [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"[^>]*data-lifecycle-junction=""/g)].map((match) => [round(Number(match[1])), round(Number(match[2]))] as Pair),
  };
}

// The same reading of a scene drawn without its legend.
export function lifecycleFixtureOfScene(scene: Scene, source: string): LifecycleLayoutFixture {
  const layer = scene.lifecycle!;
  const rect = (r: { x: number; y: number; width: number; height: number }): Box => [r.x, r.y, r.width, r.height].map(round) as Box;
  return {
    source,
    diagram_type: 'lifecycle',
    viewBox: [scene.width, scene.height],
    states: scene.nodes.map(rect),
    routes: scene.edges.map((edge) => edge.points.map(([x, y]) => [round(x), round(y)] as Pair)),
    labels: scene.diagram.edges.flatMap((edge, index) => {
      const label = layer.labels.get(edge.id);
      return label ? [[index, ...rect(label)] as [number, number, number, number, number]] : [];
    }),
    frames: layer.frames.map(rect),
    junctions: layer.junctions.map(([x, y]) => [round(x), round(y)] as Pair),
  };
}

export const formatLifecycleFixture = (fixture: LifecycleLayoutFixture) => formatDiagramJson(fixture);

const placement = ({ source: _source, ...rest }: LifecycleLayoutFixture) => JSON.stringify(rest);

export function sameLifecycleLayout(a: LifecycleLayoutFixture, b: LifecycleLayoutFixture) {
  return placement(a) === placement(b);
}
