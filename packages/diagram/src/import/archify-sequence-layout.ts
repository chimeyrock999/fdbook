// Archify's drawing of a sequence, as tests/fixtures/archify keeps it: the
// canvas, participant boxes, lifelines, each message's line, label plate and
// note, segment frames and titles, activation bars and the legend entries,
// read off the SVG `render-sequence.mjs` writes (it has no --layout-json).
// scripts/archify-fixtures.ts writes them; tests/diagram-archify.test.ts
// holds the port to them.

import { VARIANT_OUT } from './archify-sequence.ts';
import { formatDiagramJson } from '#model/format.ts';
import type { Scene } from '#layout/scene.ts';

type Box = [number, number, number, number];

export type SequenceLayoutFixture = {
  source: string;
  diagram_type: 'sequence';
  viewBox: [number, number];
  participants: Box[];
  lifelines: [number, number, number][];
  messages: { points: [number, number][]; label: Box; note?: { x: number; baseline: number; lines: string[] } }[];
  segments: { frame: Box; label: Box }[];
  activations: Box[];
  legend: [string, number, number][];
}

const round = (value: number) => Math.round(value * 100) / 100;
const numbers = (text: string) => text.split(/[\s,;]+/).filter(Boolean).map(Number);
const attr = (tag: string, name: string) => {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  if (!match) throw new Error(`no ${name} in ${tag.slice(0, 120)}`);
  return match[1];
};
const box = (tag: string): Box => [Number(attr(tag, 'x')), Number(attr(tag, 'y')), Number(attr(tag, 'width')), Number(attr(tag, 'height'))].map(round) as Box;
const unescape = (text: string) => text.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code))).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

// Reads the drawing out of the HTML page Archify writes.
export function sequenceFixtureOf(html: string, source: string): SequenceLayoutFixture {
  const svg = html.slice(html.indexOf('<svg viewBox'), html.indexOf('</svg>'));
  // Archify marks each part of the drawing with a comment; one missing means
  // the drawing changed shape, and the fixture must not be guessed.
  const section = (name: string, next: string) => {
    const start = svg.indexOf(`<!-- ${name} -->`);
    const end = svg.indexOf(`<!-- ${next} -->`);
    if (start < 0 || end < start) throw new Error(`Archify's drawing has no "${name}" part before "${next}"; read its SVG again`);
    return svg.slice(start, end);
  };
  const [, , width, height] = numbers(attr(svg.slice(0, svg.indexOf('>')), 'viewBox'));
  const participants = [...section('Participants', 'Legend').matchAll(/<g [^>]*data-node-id="[^"]*"[^>]*>\s*<title>[^<]*<\/title>\s*(<rect [^>]*>)/g)].map((match) => box(match[1]));
  const lifelines = [...section('Lifelines', 'Activations').matchAll(/<path d="M ([\d.]+) ([\d.]+) L [\d.]+ ([\d.]+)"/g)]
    .map((match) => [round(Number(match[1])), Number(match[2]), Number(match[3])] as [number, number, number]);
  const activations = [...section('Activations', 'Messages').matchAll(/<rect [^>]*class="c-mask"\/>/g)].map((match) => box(match[0]));
  const messages = section('Messages', 'Segment Labels').split(/(?=<g data-edge-from=)/).filter((part) => part.startsWith('<g data-edge-from=')).map((part) => {
    const points = attr(/<path [^>]*>/.exec(part)![0], 'data-composition-points').split(';').map((point) => numbers(point).map(round) as [number, number]);
    const label = box(/<g data-detail="context">\s*(<rect [^>]*>)/.exec(part)![1]);
    const noteTag = /<text data-detail="context" x="([\d.]+)" y="([\d.]+)"[^>]*font-size="7">(.*?)<\/text>/s.exec(part);
    if (!noteTag) return { points, label };
    const spans = [...noteTag[3].matchAll(/<tspan[^>]*>(.*?)<\/tspan>/g)].map((span) => unescape(span[1]));
    return { points, label, note: { x: round(Number(noteTag[1])), baseline: Number(noteTag[2]), lines: spans.length ? spans : [unescape(noteTag[3])] } };
  });
  const frames = [...section('Time Segments', 'Lifelines').matchAll(/<rect data-graph-role="structural-frame"[^>]*>/g)].map((match) => box(match[0]));
  const titles = [...section('Segment Labels', 'Participants').matchAll(/<g data-graph-role="segment-label"[^>]*>\s*(<rect [^>]*>)/g)].map((match) => box(match[1]));
  const legend = [...svg.matchAll(/data-legend-semantic-kind="([^"]+)"[^>]*data-legend-x="([\d.]+)" data-legend-baseline="([\d.]+)"/g)]
    .map((match) => [match[1], Number(match[2]), Number(match[3])] as [string, number, number]);
  return {
    source,
    diagram_type: 'sequence',
    viewBox: [width, height],
    participants,
    lifelines,
    messages,
    segments: frames.map((frame, index) => ({ frame, label: titles[index] })),
    activations,
    legend,
  };
}

// The same reading of a scene, so the test compares like with like.
export function sequenceFixtureOfScene(scene: Scene, source: string): SequenceLayoutFixture {
  const layer = scene.sequence!;
  const rect = (r: { x: number; y: number; width: number; height: number }): Box => [r.x, r.y, r.width, r.height].map(round) as Box;
  return {
    source,
    diagram_type: 'sequence',
    viewBox: [scene.width, scene.height],
    participants: scene.nodes.map(rect),
    lifelines: layer.lifelines.map((line) => [round(line.x), line.top, line.bottom]),
    messages: layer.messages.map((message, index) => {
      const label = scene.edges[index].label!;
      const entry = { points: [[round(message.start), message.y], [round(message.end), message.y]] as [number, number][], label: rect(label) };
      return message.note ? { ...entry, note: { x: round(message.note.x), baseline: message.note.baseline, lines: message.note.lines } } : entry;
    }),
    segments: layer.segments.map(({ frame, label }) => ({ frame: rect(frame), label: rect(label) })),
    activations: layer.activations.map(rect),
    legend: (scene.legend?.entries ?? []).map((entry) => [entry.variant ? VARIANT_OUT[entry.variant] : entry.kind, entry.x, entry.baseline]),
  };
}

export const formatSequenceFixture = (fixture: SequenceLayoutFixture) => formatDiagramJson(fixture);

const placement = ({ source: _source, ...rest }: SequenceLayoutFixture) => JSON.stringify(rest);

export function sameSequenceLayout(a: SequenceLayoutFixture, b: SequenceLayoutFixture) {
  return placement(a) === placement(b);
}
