// The checks a sequence diagram gets besides the shared ones in validate.ts:
// what a sequence cannot hold (frames, lanes, positions, self-messages),
// segment and activation ranges, and Archify's layout checks of
// render-sequence.mjs (participant text, the canvas width, message spans,
// labels, segment titles). Message spacing needs no check: the order sets
// it (lib/diagram/sequence.ts).

import { availableTextWidth, minimumReadableSourceTextPx, minimumTextWidth, rectsOverlap, textUnits } from './geometry.ts';
import type { Scene } from './scene.ts';
import type { Diagram } from './schema.ts';
import { MESSAGE_FONT, messageLabelRect, NOTE_FONT, PARTICIPANT_LABEL_UNIT, participantLabelWidth } from './sequence.ts';
import type { DiagramIssue } from './validate.ts';

const MIN_SPAN = 60;

export function checkSequenceStructure(diagram: Diagram): DiagramIssue[] {
  const issues: DiagramIssue[] = [];
  const error = (code: string, message: string, fix?: string, path?: string) => issues.push({ code, severity: 'error', message, fix, path });
  const unused = 'a sequence lays itself out from its order: participants are its nodes, messages its edges';
  if (diagram.groups.length) error('sequence/no-groups', 'A sequence has no frames around participants.', `remove groups; for phases of the timeline use segments (${unused})`, 'groups');
  if (diagram.mainPath.length) error('structure/lifecycle-only', 'A main path belongs to a lifecycle.', 'remove mainPath', 'mainPath');
  if (diagram.lanes.length) error('sequence/no-lanes', 'A sequence has no lanes: its participants are its columns.', 'remove lanes', 'lanes');
  if (Object.keys(diagram.layout).some((key) => key !== 'nodes') || Object.keys(diagram.layout.nodes).length) {
    error('sequence/no-layout', 'A sequence places everything itself; layout does not apply.', `remove layout (${unused})`, 'layout');
  }
  if (diagram.nodes.length < 2) error('sequence/one-participant', 'A sequence needs two participants or more.', 'add the participant the messages go to', 'nodes');
  diagram.nodes.forEach((node, index) => {
    if (node.tag) issues.push({ code: 'sequence/tag-unused', severity: 'warning', message: `Participant "${node.id}" has a tag, which a participant box has no room to show.`, fix: 'move it into the sublabel or the note', path: `nodes[${index}].tag` });
  });
  const order = new Map(diagram.edges.map((edge, index) => [edge.id, index]));
  const nodeIds = new Set(diagram.nodes.map((node) => node.id));
  diagram.edges.forEach((edge, index) => {
    if (edge.from === edge.to) {
      error('sequence/self-message', `Message "${edge.id}" goes from "${edge.from}" to itself; a sequence draws messages between two participants only.`,
        'keep the step and its order: say it in the detail of the message before or after it, or in a card; do not invent a participant', `edges[${index}]`);
    }
    if (!edge.label) error('sequence/unlabelled-message', `Message "${edge.id}" has no label.`, 'say what it carries: a call, an event, a reply', `edges[${index}].label`);
    if (edge.bidirectional) error('sequence/two-way-message', `Message "${edge.id}" has heads at both ends; a sequence message goes one way.`, 'add the reply as its own message with variant "return"', `edges[${index}].bidirectional`);
  });
  const range = (from: string, to: string, path: string, what: string) => {
    for (const [end, id] of [['from', from], ['to', to]] as const) {
      if (!order.has(id)) error('sequence/unknown-message', `${what} names "${id}", which is no message.`, 'name a message id from edges', `${path}.${end}`);
    }
    if (order.has(from) && order.has(to) && order.get(from)! > order.get(to)!) {
      error('sequence/range-reversed', `${what} runs from "${from}" to "${to}", which comes before it.`, 'swap from and to', path);
    }
    return order.has(from) && order.has(to) ? [Math.min(order.get(from)!, order.get(to)!), Math.max(order.get(from)!, order.get(to)!)] as const : null;
  };
  const segmentRanges = diagram.segments.map((segment, index) => range(segment.from, segment.to, `segments[${index}]`, `Segment "${segment.label}"`));
  segmentRanges.forEach((current, index) => {
    if (!current) return;
    segmentRanges.slice(index + 1).forEach((other, offset) => {
      if (other && current[0] <= other[1] && other[0] <= current[1]) {
        error('sequence/segments-overlap', `Segments "${diagram.segments[index].label}" and "${diagram.segments[index + 1 + offset].label}" share messages.`,
          'give each message to one segment at most', `segments[${index + 1 + offset}]`);
      }
    });
  });
  const activationRanges = diagram.activations.map((activation, index) => {
    if (!nodeIds.has(activation.node)) error('sequence/unknown-participant', `An activation is on "${activation.node}", which is no participant.`, 'name a node id', `activations[${index}].node`);
    return range(activation.from, activation.to, `activations[${index}]`, `The activation of "${activation.node}"`);
  });
  activationRanges.forEach((current, index) => {
    if (!current) return;
    activationRanges.slice(index + 1).forEach((other, offset) => {
      const later = diagram.activations[index + 1 + offset];
      if (other && later.node === diagram.activations[index].node && current[0] <= other[1] && other[0] <= current[1]) {
        error('sequence/activations-overlap', `Two activations of "${later.node}" share messages.`, 'join them into one, or let one end before the other starts', `activations[${index + 1 + offset}]`);
      }
    });
  });
  return issues;
}

// Structure that only a sequence may hold.
export function checkSequenceOnly(diagram: Diagram): DiagramIssue[] {
  return [
    ...(diagram.segments.length ? [{ code: 'structure/sequence-only', severity: 'error' as const, message: 'Segments belong to a sequence.', fix: 'set "type": "sequence", or remove segments', path: 'segments' }] : []),
    ...(diagram.activations.length ? [{ code: 'structure/sequence-only', severity: 'error' as const, message: 'Activations belong to a sequence.', fix: 'set "type": "sequence", or remove activations', path: 'activations' }] : []),
  ];
}

export function checkSequenceScene(scene: Scene): DiagramIssue[] {
  const layer = scene.sequence!;
  const issues: DiagramIssue[] = [];
  const error = (code: string, message: string, fix?: string, path?: string) => issues.push({ code, severity: 'error', message, fix, path });
  const { diagram } = scene;
  const nodeIndex = new Map(diagram.nodes.map((node, index) => [node.id, index]));
  const edgeIndex = new Map(diagram.edges.map((edge, index) => [edge.id, index]));
  const readable = minimumReadableSourceTextPx(scene.width);
  const tooSmall = (size: number) => size + 1e-6 < readable;
  const smallFix = `shorten the text or drop a participant: at ${scene.width}px wide, text needs ${Math.ceil(readable * 10) / 10}px or more`;
  const width = layer.participantWidth;

  for (const node of scene.nodes) {
    const field = `nodes[${nodeIndex.get(node.id)}]`;
    const labelWidth = participantLabelWidth(node.node.label);
    if (labelWidth > width + 6) {
      error('text/label-overflow', `The label of "${node.id}" needs ~${Math.round(labelWidth)}px but participants are ${width}px wide here.`,
        `shorten it to ${Math.floor((width + 6) / PARTICIPANT_LABEL_UNIT)} characters or fewer (wide characters count 2)`, `${field}.label`);
    }
    const sublabelWidth = node.node.sublabel ? minimumTextWidth(node.node.sublabel, layer.sublabelMinimum) : 0;
    if (sublabelWidth > availableTextWidth(width)) {
      error('text/sublabel-overflow', `The sublabel of "${node.id}" needs ~${Math.ceil(sublabelWidth)}px at ${layer.sublabelMinimum}px, but a participant gives ${availableTextWidth(width)}px.`,
        'shorten the sublabel; move the rest into the note', `${field}.sublabel`);
    }
    for (const [name, size] of [['label', node.labelFont], ['sublabel', node.node.sublabel ? node.sublabelFont : Infinity]] as const) {
      if (tooSmall(size)) error('text/too-small-at-desktop', `The ${name} of "${node.id}" is drawn at ${size}px, under ${Math.ceil(readable * 10) / 10}px at desktop width.`, smallFix, `${field}.${name}`);
    }
  }
  const last = scene.nodes.at(-1);
  if (last && last.x + last.width > scene.width - 40) {
    error('sequence/too-many-participants', `${scene.nodes.length} participants do not fit the ${scene.width}px canvas.`, 'drop a participant, or shorten the participant labels', 'nodes');
  }

  const labels = layer.messages.map((message) => ({ message, rect: messageLabelRect(message) }));
  layer.messages.forEach((message, index) => {
    const at = `edges[${edgeIndex.get(message.edge.id)}]`;
    const span = Math.abs((layer.columns[message.edge.to] ?? 0) - (layer.columns[message.edge.from] ?? 0));
    if (span < MIN_SPAN) error('sequence/message-too-short', `Message "${message.edge.id}" spans ${Math.round(span)}px, under ${MIN_SPAN}px.`, 'drop a participant so the columns spread', at);
    if (!message.edge.label) return;
    const { rect } = labels[index];
    if (rect.x < 0 || rect.x + rect.width > scene.width) {
      error('label/out-of-canvas', `The label of message "${message.edge.id}" reaches past the canvas.`, 'shorten the label, or move its participants inward', `${at}.label`);
    }
    for (const other of labels.slice(index + 1)) {
      if (other.message.edge.label && rectsOverlap(rect, other.rect, -2)) {
        error('label/collision', `The labels of messages "${message.edge.id}" and "${other.message.edge.id}" overlap.`, 'shorten a label', `${at}.label`);
      }
    }
  });
  if (layer.messages.some((message) => message.edge.label) && tooSmall(MESSAGE_FONT)) {
    error('text/too-small-at-desktop', `Message labels are drawn at ${MESSAGE_FONT}px, under ${Math.ceil(readable * 10) / 10}px at desktop width.`, smallFix, 'edges');
  }
  if (layer.messages.some((message) => message.note) && tooSmall(NOTE_FONT)) {
    error('text/too-small-at-desktop', `Message details are drawn at ${NOTE_FONT}px, under ${Math.ceil(readable * 10) / 10}px at desktop width.`, smallFix, 'edges');
  }

  layer.segments.forEach(({ segment, label }, index) => {
    const at = `segments[${index}]`;
    if (label.x + label.width > scene.width - 48) {
      error('sequence/segment-title-too-wide', `The title of segment "${segment.label}" is wider than its frame.`, 'shorten the title', `${at}.label`);
    }
    const covered = layer.messages.find((message) => [messageLabelRect(message), ...(message.note ? [message.note] : [])].some((rect) => rectsOverlap(label, rect, 2)));
    if (covered) {
      error('sequence/segment-label-overlap', `The title of segment "${segment.label}" covers message "${covered.edge.id}".`, 'shorten the title, or the message label', `${at}.label`);
    }
    for (const other of layer.segments.slice(index + 1)) {
      if (rectsOverlap(label, other.label)) error('sequence/segment-label-overlap', `The titles of segments "${segment.label}" and "${other.segment.label}" overlap.`, 'shorten a title', `${at}.label`);
    }
  });

  if (scene.legendUnfit) {
    issues.push({ code: 'legend/unfit', severity: 'warning', message: 'The legend does not fit below the diagram, so it is hidden.', fix: 'shorten the timeline, or set "legend": false', path: 'legend' });
  }
  return issues;
}
