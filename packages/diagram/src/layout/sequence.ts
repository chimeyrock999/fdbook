// Lays a sequence diagram out: participants (the diagram's nodes) in columns
// across the top, each with a lifeline, and messages (its edges) down the
// timeline in the order the file lists them. The geometry is Archify's
// sequence renderer (MIT, renderers/sequence/render-sequence.mjs) under its
// showcase profile with an automatic canvas: spread columns, message labels
// and wrapped notes, segment frames and their titles, activation bars and the
// variant legend. Archify takes each message's `y` from its author; here the
// order gives it, spaced so Archify's own checks hold (see messageYs).

import { availableTextWidth, fittedNodeFontSize, minimumReadableSourceTextPx, minimumTextWidth, rectsOverlap, textUnits, type Rect } from './geometry.ts';
import { legendFootprint, placeLegend, variantLegendEntries } from './legend.ts';
import type { Scene, SceneEdge, SceneNode } from './scene.ts';
import type { Diagram, DiagramActivation, DiagramEdge, DiagramSegment } from '#model/schema.ts';

// How wide Archify takes a participant label to be, at 11px bold.
export const PARTICIPANT_LABEL_UNIT = 6.8;
export const participantLabelWidth = (label: string) => textUnits(label) * PARTICIPANT_LABEL_UNIT;
// A segment title's pill.
const segmentTitleWidth = (label: string) => Math.max(42, textUnits(label) * 5.2 + 14);

const SUBLABEL_PREFERRED = 7;
export const SUBLABEL_MINIMUM = 6;
// The 930px desktop reading column at the 6px floor: past this width the
// 7px sublabels read too small.
const READABLE_CANVAS_WIDTH = Math.floor(930 * SUBLABEL_PREFERRED / 6);

export const TOP_Y = 72;
export const PARTICIPANT_H = 60;
const LABEL_Y = 36;
const SUBLABEL_Y = 50;
export const LIFELINE_TOP = 142;
const LIFELINE_FOOTER = 65;
const MIN_AUTO_HEIGHT = 327;
// The legend block below the content: 12px clear of it, then the title, a
// row and the 54px baseline inset.
const LEGEND_CONTENT_GAP = 12;
const LEGEND_BLOCK_HEIGHT = 86;
const LEGEND_BASELINE_INSET = 54;

export const MESSAGE_FONT = 11;
export const MESSAGE_UNIT_WIDTH = 6.6;
const MESSAGE_LABEL_H = 18;
const ARROW_INSET = 7;

// A note (the message's `detail`) wraps inside one gap between neighbouring
// lifelines, under the arrow, keeping every character.
export const NOTE_FONT = 7;
export const NOTE_LINE_HEIGHT = NOTE_FONT + 4;
const NOTE_TEXT_INSET = 12;
const NOTE_LIFELINE_CLEARANCE = 11;
const NOTE_GAP_TOLERANCE = 0.5;
const NOTE_BREAK_AFTER = new Set(['/', '.', '-', '?', '&', '=', '#', '_']);

const SEGMENT_X = 48;
const SEGMENT_LABEL_X = 56;

// Where messages go, from the order alone: the first under the headers, each
// next one far enough below the last for Archify's 28px rule, the note above
// it, and a segment frame's border and title between them.
const FIRST_Y = 168;
const FIRST_Y_UNDER_SEGMENT = 186;
const MESSAGE_GAP = 42;
const CLEAR_BELOW = 24;
const SEGMENT_TOP = 30;
const SEGMENT_BOTTOM = 14;
const SEGMENT_TITLE_ROOM = 54;
const ACTIVATION_TOP = 6;
const ACTIVATION_BOTTOM = 8;

export interface SequenceNote extends Rect {
  x: number;
  baseline: number;
  lines: string[];
}

export interface SequenceMessage {
  edge: DiagramEdge;
  y: number;
  start: number;
  end: number;
  note: SequenceNote | null;
}

export interface SequenceSegment {
  segment: DiagramSegment;
  frame: Rect;
  label: Rect;
}

export interface SequenceActivation extends Rect {
  activation: DiagramActivation;
}

export interface SequenceLayer {
  participantWidth: number;
  // The column centre of each participant, by id.
  columns: Record<string, number>;
  lifelines: { node: string; x: number; top: number; bottom: number }[];
  messages: SequenceMessage[];
  segments: SequenceSegment[];
  activations: SequenceActivation[];
  // The lowest timeline content: the last message and its note, the
  // activation bars and the segment frames.
  contentBottom: number;
  // The 7px sublabel floor the canvas width allows.
  sublabelMinimum: number;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
let words: Intl.Segmenter | undefined;

const noteWidth = (text: string) => minimumTextWidth(text, NOTE_FONT);

// Index after the last punctuation break in `piece`, or its full length.
function noteBreakIndex(piece: string) {
  for (let index = piece.length - 1; index > 0; index -= 1) {
    if (NOTE_BREAK_AFTER.has(piece[index - 1])) return index;
  }
  return piece.length;
}

function wrapWords(tokens: readonly string[], width: number) {
  const lines: string[] = [];
  let line = '';
  const flush = () => {
    const trimmed = line.trimEnd();
    if (trimmed) lines.push(trimmed);
    line = '';
  };
  for (const word of tokens) {
    if (/^\s+$/u.test(word)) {
      if (line) line += ' ';
      continue;
    }
    if (noteWidth(line + word) <= width) {
      line += word;
      continue;
    }
    flush();
    let piece = '';
    for (const { segment } of graphemes.segment(word)) {
      while (piece && noteWidth(piece + segment) > width) {
        const cut = noteBreakIndex(piece);
        lines.push(piece.slice(0, cut));
        piece = piece.slice(cut);
      }
      piece += segment;
    }
    line = piece;
  }
  flush();
  return lines;
}

// Long unbroken text breaks after its punctuation, otherwise at any
// character; Chinese breaks between words where that saves a line.
export function wrapNote(text: string, width: number) {
  const original = wrapWords(text.match(/\s+|\S+/gu) ?? [], width);
  if (!/\p{Script=Han}/u.test(text)) return original;
  words ??= new Intl.Segmenter(undefined, { granularity: 'word' });
  const tokens: string[] = [];
  for (const token of text.match(/\s+|\p{Script=Han}[\p{Script=Han}\p{Mark}]*|[^\s\p{Script=Han}]+/gu) ?? []) {
    if (/\p{Script=Han}/u.test(token)) {
      for (const { segment } of words.segment(token)) tokens.push(segment);
    } else if (/^[、。，；：！？）】》」』]+$/u.test(token) && tokens.length) {
      tokens[tokens.length - 1] += token;
    } else tokens.push(token);
  }
  const compact = wrapWords(tokens, width);
  return compact.length < original.length ? compact : original;
}

// The participant box width a spread canvas `canvasWidth` wide gives.
const spreadWidth = (canvasWidth: number, count: number) => Math.max(86, Math.min(190, Math.round((canvasWidth - 124) / Math.max(1, count)) - 24));

function spreadColumns(canvasWidth: number, count: number, width = spreadWidth(canvasWidth, count)) {
  const span = count * width + (count - 1) * 16;
  const margin = Math.max(40, Math.min(62, canvasWidth - 40 - span));
  return { width, margin, gap: count > 1 ? Math.max(width + 16, (canvasWidth - 40 - margin - width) / (count - 1)) : 108 };
}

const labelWidth = (label: string | undefined) => Math.max(34, textUnits(label) * MESSAGE_UNIT_WIDTH + 12);

// Whether every message label and segment title fits a canvas this wide.
function labelsFit(diagram: Diagram, canvasWidth: number) {
  const count = diagram.nodes.length;
  const { width, margin, gap } = spreadColumns(canvasWidth, count);
  const centres = new Map(diagram.nodes.map((node, index) => [node.id, margin + width / 2 + index * gap]));
  return diagram.edges.every((edge) => {
    const from = centres.get(edge.from);
    const to = centres.get(edge.to);
    if (from === undefined || to === undefined) return true;
    const half = labelWidth(edge.label) / 2;
    return (from + to) / 2 - half >= 0 && (from + to) / 2 + half <= canvasWidth;
  }) && diagram.segments.every((segment) => SEGMENT_LABEL_X + segmentTitleWidth(segment.label) <= canvasWidth - 48);
}

// The canvas width: 920 for four participants or more, narrower for two or
// three short ones, wider (up to the readable limit) for labels that need it.
export function sequenceCanvasWidth(diagram: Diagram) {
  const count = Math.max(1, diagram.nodes.length);
  const fits = (width: number) => diagram.nodes.every((node) => participantLabelWidth(node.label) <= width + 6
    && (!node.sublabel || minimumTextWidth(node.sublabel, SUBLABEL_MINIMUM) <= availableTextWidth(width)));
  if (fits(spreadWidth(920, count))) {
    if (count <= 3) {
      for (const candidate of [560, 640, 720, 800, 920]) {
        const box = spreadWidth(candidate, count);
        if (box >= 86 && fits(box) && candidate - 80 >= count * box + (count - 1) * 16 && labelsFit(diagram, candidate)) return candidate;
      }
    }
    return 920;
  }
  const needed = Math.max(...diagram.nodes.map((node) => Math.max(
    participantLabelWidth(node.label) - 6,
    node.sublabel ? minimumTextWidth(node.sublabel, SUBLABEL_PREFERRED) + 86 - availableTextWidth(86) : 0,
  )));
  return Math.min(READABLE_CANVAS_WIDTH, Math.max(920, Math.ceil((Math.min(190, needed) + 25) * count + 124)));
}

// The columns: box width, left margin and the distance between centres.
function columnsFor(diagram: Diagram, canvasWidth: number, sublabelMinimum: number) {
  const count = Math.max(1, diagram.nodes.length);
  const nominal = spreadColumns(canvasWidth, count);
  // Only a label that does not fit opens the spare room beside the columns.
  if (!diagram.nodes.some((node) => participantLabelWidth(node.label) > nominal.width + 6)) return nominal;
  const required = Math.ceil(Math.max(nominal.width, ...diagram.nodes.map((node) => Math.max(
    participantLabelWidth(node.label) - 6,
    node.sublabel ? minimumTextWidth(node.sublabel, sublabelMinimum) + nominal.width - availableTextWidth(nominal.width) : 0,
  ))));
  const capacity = Math.floor(Math.min(190, (canvasWidth - 80 - (count - 1) * 16) / count));
  if (required > capacity) return nominal;
  return spreadColumns(canvasWidth, count, required);
}

// Each message's y, in file order. A segment's frame opens 30px above its
// first message and closes 14px below its last one's bottom, with its title
// on the top border; activations reach 6px above and 8px below.
function messageYs(diagram: Diagram, noteBottom: (edge: DiagramEdge, y: number) => number) {
  const index = new Map(diagram.edges.map((edge, at) => [edge.id, at]));
  const opens = new Set(diagram.segments.map((segment) => index.get(segment.from)));
  const closes = new Set(diagram.segments.map((segment) => index.get(segment.to)));
  const ys: number[] = [];
  diagram.edges.forEach((edge, at) => {
    if (at === 0) {
      ys.push(opens.has(0) ? FIRST_Y_UNDER_SEGMENT : FIRST_Y);
      return;
    }
    const previous = diagram.edges[at - 1];
    const y = ys[at - 1];
    const bottom = noteBottom(previous, y);
    let next = Math.max(y + MESSAGE_GAP, bottom + CLEAR_BELOW);
    const closed = closes.has(at - 1) ? bottom + SEGMENT_BOTTOM : null;
    if (closed !== null) next = Math.max(next, closed + CLEAR_BELOW);
    if (opens.has(at)) next = Math.max(next, (closed ?? bottom) + SEGMENT_TITLE_ROOM + (closed === null ? 0 : 16));
    ys.push(next);
  });
  return ys;
}

export function buildSequenceScene(diagram: Diagram): Scene {
  const width = sequenceCanvasWidth(diagram);
  const sublabelMinimum = Math.max(SUBLABEL_MINIMUM, Math.ceil(minimumReadableSourceTextPx(width) * 10) / 10);
  const sublabelPreferred = Math.max(SUBLABEL_PREFERRED, sublabelMinimum);
  const geometry = columnsFor(diagram, width, sublabelMinimum);
  const participantW = geometry.width;
  const leftX = geometry.margin + participantW / 2;
  const columns: Record<string, number> = Object.fromEntries(diagram.nodes.map((node, index) => [node.id, leftX + index * geometry.gap]));
  const order = new Map(diagram.nodes.map((node, index) => [node.id, index]));
  const columnX = (index: number) => leftX + index * geometry.gap;

  // The widest gap the message spans; equal gaps resolve to the left-most.
  const noteGap = (from: number, to: number) => {
    let best: { gap: number; width: number } | null = null;
    for (let gap = Math.min(from, to); gap < Math.max(from, to); gap += 1) {
      const gapWidth = columnX(gap + 1) - columnX(gap);
      if (!best || gapWidth > best.width + NOTE_GAP_TOLERANCE) best = { gap, width: gapWidth };
    }
    return best?.gap ?? null;
  };
  const noteAt = (edge: DiagramEdge, y: number): SequenceNote | null => {
    const from = order.get(edge.from);
    const to = order.get(edge.to);
    if (!edge.detail || from === undefined || to === undefined || from === to) return null;
    const gap = noteGap(from, to)!;
    const x = columnX(gap) + ARROW_INSET + NOTE_TEXT_INSET;
    const maxWidth = Math.max(1, columnX(gap + 1) - NOTE_LIFELINE_CLEARANCE - x);
    const lines = noteWidth(edge.detail) <= maxWidth ? [edge.detail] : wrapNote(edge.detail, maxWidth);
    const baseline = y + 18;
    const top = baseline - NOTE_FONT * 1.2;
    const bottom = y + 22 + (lines.length - 1) * NOTE_LINE_HEIGHT;
    return { x, y: top, width: Math.max(...lines.map(noteWidth)), height: bottom - top, baseline, lines };
  };
  // Each note is wrapped once, while the timeline is spaced, and kept.
  const notes = new Map<DiagramEdge, SequenceNote | null>();
  const bottomOf = (edge: DiagramEdge, y: number) => {
    const note = noteAt(edge, y);
    notes.set(edge, note);
    return note ? note.y + note.height : y + 6;
  };

  const ys = messageYs(diagram, bottomOf);
  const messages: SequenceMessage[] = diagram.edges.map((edge, index) => {
    const y = ys[index];
    const from = columns[edge.from] ?? 0;
    const to = columns[edge.to] ?? 0;
    const direction = to > from ? 1 : -1;
    // The last message's note was never needed for spacing.
    const note = notes.has(edge) ? notes.get(edge)! : noteAt(edge, y);
    return { edge, y, start: from + direction * ARROW_INSET, end: to - direction * ARROW_INSET, note };
  });
  const yOf = new Map(messages.map((message) => [message.edge.id, message]));
  const bottomOfMessage = (message: SequenceMessage) => (message.note ? message.note.y + message.note.height : message.y + 6);

  const segmentRanges = diagram.segments.flatMap((segment) => {
    const first = yOf.get(segment.from);
    const last = yOf.get(segment.to);
    if (!first || !last) return [];
    return [{ segment, from: first.y - SEGMENT_TOP, to: bottomOfMessage(last) + SEGMENT_BOTTOM }];
  });
  const activations: SequenceActivation[] = diagram.activations.flatMap((activation) => {
    const first = yOf.get(activation.from);
    const last = yOf.get(activation.to);
    const x = columns[activation.node];
    if (!first || !last || x === undefined) return [];
    const top = first.y - ACTIVATION_TOP;
    return [{ activation, x: x - 5, y: top, width: 10, height: last.y + ACTIVATION_BOTTOM - top }];
  });

  const contentBottom = Math.max(0,
    ...messages.map((message) => (message.note ? bottomOfMessage(message) : message.y + 6)),
    ...activations.map((bar) => bar.y + bar.height),
    ...segmentRanges.map((range) => range.to));
  const entries = variantLegendEntries(diagram);
  const legendHeight = entries.length
    ? Math.ceil(contentBottom + LEGEND_CONTENT_GAP + LEGEND_BLOCK_HEIGHT + legendFootprint(entries, width - 80).extraHeight)
    : 0;
  const height = Math.max(MIN_AUTO_HEIGHT, contentBottom + LIFELINE_FOOTER, ...messages.map((message) => message.y + 18 + LIFELINE_FOOTER), legendHeight);
  const lifelineBottom = height - LIFELINE_FOOTER;

  const nodes: SceneNode[] = diagram.nodes.map((node) => {
    const cx = columns[node.id];
    const x = cx - participantW / 2;
    return {
      id: node.id, x, y: TOP_Y, width: participantW, height: PARTICIPANT_H, cx, cy: TOP_Y + PARTICIPANT_H / 2,
      node,
      kind: diagram.kinds.find((kind) => kind.id === node.kind)!,
      labelFont: fittedNodeFontSize(node.label, participantW, 11, 8),
      sublabelFont: node.sublabel ? fittedNodeFontSize(node.sublabel, participantW, sublabelPreferred, sublabelMinimum) : sublabelPreferred,
      tagFont: 7,
      context: [],
      text: { label: TOP_Y + LABEL_Y, sublabel: TOP_Y + SUBLABEL_Y },
    };
  });

  // ---- Segment titles: on the top border, stepping up off message labels,
  // routes and notes; inside the frame when that pushes them out of it.
  const occupants: Rect[] = messages.flatMap((message) => [
    messageLabelRect(message),
    { x: Math.min(message.start, message.end), y: message.y - 2, width: Math.abs(message.end - message.start), height: 4 },
    ...(message.note ? [message.note] : []),
  ]);
  const misplaced = (label: Rect, range: { segment: DiagramSegment; from: number; to: number }) => {
    const half = label.height / 2;
    if (TOP_Y + PARTICIPANT_H - label.y > half) return true;
    if (label.y >= range.from - 22) return false;
    return segmentRanges.some((other) => other !== range && Math.min(label.y + label.height, other.to) - Math.max(label.y, other.from) > half);
  };
  const titleOf = (range: (typeof segmentRanges)[number]): Rect => {
    const width = segmentTitleWidth(range.segment.label);
    const label = { x: SEGMENT_LABEL_X, y: range.from - 22, width, height: 18 };
    for (let attempt = 0; attempt < 4 && occupants.some((rect) => rectsOverlap(label, rect, 2)); attempt += 1) label.y -= 22;
    if (!misplaced(label, range)) return label;
    const others = segmentRanges.filter((other) => other !== range).map((other) => ({ x: SEGMENT_LABEL_X, y: other.from - 22, width: segmentTitleWidth(other.segment.label), height: 18 }));
    const inside = { x: SEGMENT_LABEL_X, y: range.from + 4, width, height: 18 };
    for (let attempt = 0; attempt < 4 && inside.y + inside.height <= range.to - 2; attempt += 1) {
      if (!misplaced(inside, range) && ![...occupants, ...others, ...nodes].some((rect) => rectsOverlap(inside, rect, 2))) return inside;
      inside.y += 22;
    }
    return label;
  };
  const segments: SequenceSegment[] = segmentRanges.map((range) => ({
    segment: range.segment,
    frame: { x: SEGMENT_X, y: range.from, width: width - SEGMENT_X * 2, height: range.to - range.from },
    label: titleOf(range),
  }));

  const edges: SceneEdge[] = messages.map((message) => {
    const rect = messageLabelRect(message);
    return {
      edge: message.edge,
      points: [[message.start, message.y], [message.end, message.y]],
      d: `M${message.start} ${message.y}H${message.end}`,
      strokeWidth: message.edge.variant === 'emphasis' ? 1.8 : 1.4,
      automatic: false,
      label: message.edge.label ? { ...rect, lx: rect.x + rect.width / 2, ly: message.y - 10 } : null,
    };
  });

  const legend = placeLegend(entries, {
    x: 40,
    baselineY: height - LEGEND_BASELINE_INSET,
    width: width - 80,
    minTitleY: Math.max(LIFELINE_TOP, contentBottom + LEGEND_CONTENT_GAP),
    obstacles: [],
  });
  // Lifelines stop above the legend title.
  const lifelineEnd = legend ? Math.min(lifelineBottom, legend.titleY - 22) : lifelineBottom;

  return {
    type: 'sequence',
    diagram,
    width,
    height,
    nodes,
    frames: [],
    edges,
    lanes: [],
    legend,
    legendUnfit: entries.length > 0 && legend === null,
    lifecycle: null,
    sequence: {
      participantWidth: participantW,
      columns,
      lifelines: diagram.nodes.map((node) => ({ node: node.id, x: columns[node.id], top: LIFELINE_TOP, bottom: lifelineEnd })),
      messages,
      segments,
      activations,
      contentBottom,
      sublabelMinimum,
    },
  };
}

export function messageLabelRect(message: Pick<SequenceMessage, 'edge' | 'start' | 'end' | 'y'>): Rect {
  const width = labelWidth(message.edge.label);
  return { x: (message.start + message.end) / 2 - width / 2, y: message.y - 20, width, height: MESSAGE_LABEL_H };
}
