// Archify sequence specs (schema v1) both ways. importArchifySequence turns
// one into a diagram: participants become nodes with the kinds of
// import-archify.ts, messages become edges in their `y` order, a note
// becomes the message's detail, and segment and activation pixel ranges
// become the messages they span. sequenceSpecOf turns a laid-out sequence
// back into a spec with the `y` the layout chose, which Archify then draws:
// scripts/archify-fixtures.ts keeps that drawing as the parity fixture.

import { diagramSchema, type DiagramInput, type EdgeVariant } from '#model/schema.ts';
import type { Scene } from '#layout/scene.ts';
import { ARCHIFY_TYPES, DOT_TONE, EVIDENCE, defined, mdxText, nonEmpty, uniqueId, type ArchifyNote, type ImportOptions } from './import-archify.ts';

export type ArchifySequenceSpec = {
  schema_version?: 1;
  diagram_type: 'sequence';
  meta: { title: string; output?: string; quality_profile?: string; legend?: { entries?: Record<string, { label?: string }> } };
  participants: { id: string; type: string; label: string; sublabel?: string }[];
  segments?: { from: number; to: number; label: string }[];
  messages: { id?: string; from: string; to: string; y: number; label: string; variant?: string; note?: string }[];
  activations?: { participant: string; from: number; to: number; type?: string }[];
  cards?: { dot?: string; title: string; items: string[] }[];
}

// The variant names that differ: Archify's security line is our alert.
const VARIANT_IN: Record<string, EdgeVariant | undefined> = { security: 'alert', emphasis: 'emphasis', dashed: 'dashed', return: 'return' };
export const VARIANT_OUT: Record<EdgeVariant, string> = { default: 'default', emphasis: 'emphasis', alert: 'security', dashed: 'dashed', return: 'return' };

// The `.notes.json` sidecar gives participants their notes, as it gives
// architecture components theirs.
export function importArchifySequence(spec: ArchifySequenceSpec, { schemaPath, notes }: Pick<ImportOptions, 'schemaPath' | 'notes'> = {}): DiagramInput {
  const taken = new Set<string>([...spec.participants.map((participant) => participant.id), ...spec.messages.flatMap((message) => (message.id ? [message.id] : []))]);
  const used = new Set(spec.participants.map((participant) => participant.type));
  const kindIds = new Map<string, string>();
  const kinds = Object.entries(ARCHIFY_TYPES).filter(([type]) => used.has(type)).map(([type, { label, tone, icon }]) => {
    const id = uniqueId(label, 'kind', taken);
    kindIds.set(type, id);
    return { id, label, tone, icon };
  });
  const messages = [...spec.messages].sort((a, b) => a.y - b.y).map((message) => ({
    ...message,
    id: message.id ?? uniqueId(message.label, 'message', taken),
  }));
  // The messages a pixel range holds, first and last.
  const spanned = (from: number, to: number, participant?: string) => {
    const inside = messages.filter((message) => message.y >= from && message.y <= to && (!participant || message.from === participant || message.to === participant));
    const last = inside.at(-1);
    return last ? { from: inside[0].id, to: last.id } : null;
  };
  const evidence = new Set(Object.values(notes ?? {}).map((note) => note.evidence));
  const badges = (Object.keys(EVIDENCE) as ArchifyNote['evidence'][]).filter((level) => evidence.has(level)).map((level) => ({ id: level, ...EVIDENCE[level] }));
  const input: DiagramInput = {
    $schema: schemaPath,
    version: 1,
    type: 'sequence',
    title: spec.meta.title,
    kinds,
    badges,
    nodes: spec.participants.map((participant) => {
      const note = notes?.[participant.id];
      const kind = kindIds.get(participant.type);
      if (kind === undefined) throw new Error(`participant "${participant.id}" has type "${participant.type}", which Archify does not have: use one of ${Object.keys(ARCHIFY_TYPES).join(', ')}`);
      return defined({
        id: participant.id,
        kind,
        label: participant.label,
        sublabel: nonEmpty(participant.sublabel),
        note: note && defined({ role: mdxText(note.role), badge: note.evidence, points: note.points?.map(mdxText) }),
      });
    }),
    edges: messages.map((message) => defined({
      id: message.id,
      from: message.from,
      to: message.to,
      label: message.label,
      detail: nonEmpty(message.note),
      variant: VARIANT_IN[message.variant ?? 'default'],
    })),
    segments: segmentsOf(spec, messages, spanned),
    activations: (spec.activations ?? []).flatMap((activation) => {
      const range = spanned(activation.from, activation.to, activation.participant);
      return range ? [{ node: activation.participant, ...range }] : [];
    }),
    cards: (spec.cards ?? []).map((card) => {
      const tone = DOT_TONE[card.dot ?? 'cyan'];
      return defined({ title: card.title, tone: tone === 'blue' ? undefined : tone, items: card.items.map(mdxText) });
    }),
  };
  if (!input.badges?.length) delete input.badges;
  if (!input.segments?.length) delete input.segments;
  if (!input.activations?.length) delete input.activations;
  if (!input.cards?.length) delete input.cards;
  if (input.$schema === undefined) delete input.$schema;
  diagramSchema.parse(input);
  return input;
}

// Archify lets phases nest; here segments do not (sequence/segments-overlap),
// so a spec whose segments share a message is refused with what to change.
function segmentsOf(spec: ArchifySequenceSpec, messages: { id: string }[], spanned: (from: number, to: number) => { from: string; to: string } | null) {
  const order = new Map(messages.map((message, index) => [message.id, index]));
  const at = (id: string) => {
    const index = order.get(id);
    if (index === undefined) throw new Error(`no message "${id}"`);
    return index;
  };
  const segments = (spec.segments ?? []).flatMap((segment) => {
    const range = spanned(segment.from, segment.to);
    return range ? [{ label: segment.label, ...range }] : [];
  });
  segments.forEach((segment, index) => {
    for (const other of segments.slice(index + 1)) {
      if (at(segment.from) <= at(other.to) && at(other.from) <= at(segment.to)) {
        throw new Error(`segments "${segment.label}" and "${other.label}" share messages; Archify nests phases, a diagram's segments do not: make them consecutive in the spec (or drop the outer one) and import again`);
      }
    }
  });
  return segments;
}

// A spec Archify draws as the scene does: the same participants, messages
// at the scene's y, segments and activations at its pixel ranges, an
// automatic canvas (no viewBox) and our legend names.
export function sequenceSpecOf(scene: Scene): ArchifySequenceSpec {
  const layer = scene.sequence;
  if (!layer) throw new Error('sequenceSpecOf takes a sequence scene');
  const { diagram } = scene;
  const typeOf = (kind: string) => Object.entries(ARCHIFY_TYPES).find(([, { tone }]) => tone === diagram.kinds.find((each) => each.id === kind)?.tone)?.[0] ?? 'external';
  return {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: {
      title: diagram.title,
      output: 'out.html',
      quality_profile: 'showcase',
      // A sequence's legend lists only message variants.
      legend: { entries: Object.fromEntries((scene.legend?.entries ?? []).flatMap(({ variant, label }) => (variant ? [[VARIANT_OUT[variant], { label }] as const] : []))) },
    },
    participants: diagram.nodes.map((node) => defined({ id: node.id, type: typeOf(node.kind), label: node.label, sublabel: node.sublabel })),
    segments: layer.segments.map(({ segment, frame }) => ({ from: frame.y, to: frame.y + frame.height, label: segment.label })),
    messages: layer.messages.map(({ edge, y }) => {
      if (edge.label === undefined) throw new Error(`message "${edge.id}" has no label, which Archify needs`);
      return defined({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        y,
        label: edge.label,
        variant: edge.variant === 'default' ? undefined : VARIANT_OUT[edge.variant],
        note: edge.detail,
      });
    }),
    activations: layer.activations.map(({ activation, y, height }) => ({ participant: activation.node, from: y, to: y + height })),
  };
}
