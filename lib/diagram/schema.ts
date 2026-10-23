import { z } from 'zod';

// The `.diagram.json` format: what a diagram says (nodes, groups, edges,
// lanes, cards) apart from where it is drawn (`layout`), so a change of
// meaning reads as its own diff. Positions are in SVG user units.

// The colours a kind, a badge or a card can take; styles/diagram.css gives
// each one a light and a dark value.
export const TONES = ['blue', 'green', 'gold', 'orange', 'red', 'teal', 'slate'] as const;
// What a diagram draws: an architecture places its nodes where `layout` says;
// a sequence lays its participants (nodes) out in columns and its messages
// (edges) down the timeline in the order the file lists them.
export const DIAGRAM_TYPES = ['architecture', 'sequence'] as const;
// `return` is a reply, quieter than the call it answers; sequences use it.
export const EDGE_VARIANTS = ['default', 'emphasis', 'dashed', 'alert', 'return'] as const;
export const SIDES = ['top', 'right', 'bottom', 'left'] as const;
// The small glyphs a kind can show in a node's corner.
export const ICONS = [
  'window', 'code', 'cylinder', 'cloud', 'shield', 'queue', 'external',
  'calendar', 'clock', 'person', 'briefcase', 'flag', 'moon', 'dot', 'none',
] as const;

const id = z.string().regex(/^[A-Za-z][\w-]*$/, 'an id starts with a letter and holds letters, digits, _ or -');
const text = z.string().trim().min(1);
const point = z.tuple([z.number(), z.number()]);

// What the diagram calls its nodes: each kind has a name for the legend, a
// tone and an optional icon.
const kindSchema = z.strictObject({
  id,
  label: text,
  tone: z.enum(TONES),
  icon: z.enum(ICONS).optional(),
});

// Labels a note can carry, such as how sure the author is of it.
const badgeSchema = z.strictObject({ id, label: text, tone: z.enum(TONES) });

const noteSchema = z.strictObject({
  role: text,
  badge: id.optional(),
  points: z.array(text).optional(),
});

const nodeSchema = z.strictObject({
  id,
  kind: id,
  label: text,
  sublabel: text.optional(),
  tag: text.optional(),
  note: noteSchema.optional(),
});

const groupSchema = z.strictObject({
  id,
  label: text,
  tone: z.enum(TONES).default('orange'),
  // A dashed frame, for a boundary that is a rule rather than a place.
  dashed: z.boolean().default(false),
  // Node ids, or ids of other groups whose nodes this one also wraps.
  members: z.array(id).min(1),
});

const edgeSchema = z.strictObject({
  id,
  from: id,
  to: id,
  label: text.optional(),
  // A second, smaller line under the label.
  detail: text.optional(),
  variant: z.enum(EDGE_VARIANTS).default('default'),
  bidirectional: z.boolean().default(false),
});

const laneSchema = z.strictObject({ id, label: text });

const cardSchema = z.strictObject({
  title: text,
  tone: z.enum(TONES).default('blue'),
  items: z.array(text).min(1),
});

// A sequence's phase: a frame around the messages from `from` to `to`.
const segmentSchema = z.strictObject({ label: text, from: id, to: id });

// A sequence participant busy from message `from` to message `to`.
const activationSchema = z.strictObject({ node: id, from: id, to: id });

const box = z.strictObject({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });

const layoutSchema = z.strictObject({
  // The SVG canvas; omitted, it is fitted to the content.
  canvas: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  nodes: z.record(z.string(), box),
  groups: z.record(z.string(), z.strictObject({
    // Space between the members and the frame; the top also holds the title.
    pad: z.number().nonnegative().optional(),
    // Extra frame below the members, for nested frames that would share a bottom edge.
    grow: z.number().nonnegative().optional(),
  })).optional(),
  edges: z.record(z.string(), z.strictObject({
    fromSide: z.enum(SIDES).optional(),
    toSide: z.enum(SIDES).optional(),
    // Waypoints between the two ends; the route then skips automatic planning.
    via: z.array(point).optional(),
    labelAt: point.optional(),
    labelDx: z.number().optional(),
    labelDy: z.number().optional(),
  })).optional(),
  lanes: z.record(z.string(), box).optional(),
});

export const diagramSchema = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(1),
  type: z.enum(DIAGRAM_TYPES).default('architecture'),
  title: text,
  kinds: z.array(kindSchema).min(1),
  badges: z.array(badgeSchema).default([]),
  // The legend lists the kinds in use; `false` hides it.
  legend: z.boolean().default(true),
  nodes: z.array(nodeSchema).min(1),
  groups: z.array(groupSchema).default([]),
  edges: z.array(edgeSchema).default([]),
  lanes: z.array(laneSchema).default([]),
  cards: z.array(cardSchema).default([]),
  // Sequence only.
  segments: z.array(segmentSchema).default([]),
  activations: z.array(activationSchema).default([]),
  // Architecture only: a sequence is laid out from its order alone.
  layout: layoutSchema.default(() => ({ nodes: {} })),
});

export type DiagramInput = z.input<typeof diagramSchema>;
export type Diagram = z.output<typeof diagramSchema>;
export type DiagramNode = Diagram['nodes'][number];
export type DiagramGroup = Diagram['groups'][number];
export type DiagramEdge = Diagram['edges'][number];
export type DiagramLane = Diagram['lanes'][number];
export type DiagramCard = Diagram['cards'][number];
export type DiagramSegment = Diagram['segments'][number];
export type DiagramActivation = Diagram['activations'][number];
export type DiagramType = (typeof DIAGRAM_TYPES)[number];
export type DiagramNote = NonNullable<DiagramNode['note']>;
export type DiagramKind = Diagram['kinds'][number];
export type DiagramBadge = Diagram['badges'][number];
export type DiagramLayout = Diagram['layout'];
export type Tone = (typeof TONES)[number];
export type EdgeVariant = (typeof EDGE_VARIANTS)[number];
export type Side = (typeof SIDES)[number];

export function parseDiagram(value: unknown): Diagram {
  return diagramSchema.parse(value);
}

// The JSON Schema editors and agents validate a `.diagram.json` against,
// committed as diagrams/diagram.schema.json.
export function diagramJsonSchema() {
  return z.toJSONSchema(diagramSchema, { io: 'input' });
}
