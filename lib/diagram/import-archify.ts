// Converts an Archify spec (architecture or dataflow) and its `.notes.json`
// sidecar into a diagram. Architecture specs map field for field; a dataflow
// spec's stage/row grid becomes positions and its stages become lanes, with
// the same layout constants Archify's dataflow compiler uses. Archify's fixed
// component types become the diagram's own kinds, named as its legend named
// them, and the sidecar's evidence levels become badges.

import { diagramSchema, type DiagramInput, type EdgeVariant, type ICONS, type Tone } from './schema.ts';

type Pair = [number, number];

interface ArchifyMeta {
  title: string;
  viewBox?: Pair;
  legend?: { mode?: 'auto' | 'all' | 'hidden'; entries?: Record<string, { label?: string; visible?: boolean }> };
}

interface ArchifyNode {
  id: string;
  type: string;
  label: string;
  sublabel?: string;
  tag?: string;
  icon?: string;
  pos?: Pair;
  size?: Pair;
  stage?: number;
  row?: number;
  width?: number;
  height?: number;
  yOffset?: number;
}

interface ArchifyRelation {
  id?: string;
  from: string;
  to: string;
  label?: string;
  classification?: string;
  variant?: string;
  fromSide?: string;
  toSide?: string;
  via?: Pair[];
  labelAt?: Pair;
  labelDx?: number;
  labelDy?: number;
}

export interface ArchifySpec {
  diagram_type: 'architecture' | 'dataflow';
  meta: ArchifyMeta;
  components?: ArchifyNode[];
  boundaries?: { kind?: string; label: string; wraps: string[]; pad?: number }[];
  connections?: ArchifyRelation[];
  nodes?: ArchifyNode[];
  stages?: { label: string }[];
  flows?: ArchifyRelation[];
  cards?: { dot?: string; title: string; items: string[] }[];
}

export interface ArchifyNote {
  role: string;
  evidence: 'observed' | 'inferred' | 'hypothesis';
  points?: string[];
}

export interface ImportOptions {
  // The `.notes.json` sidecar: node id → { role, evidence, points }.
  notes?: Record<string, ArchifyNote>;
  // `--grow-frame <index>@<px>` from the old regen script: extra frame
  // height below the members, by boundary index.
  growFrames?: Record<number, number>;
  // Where the generated file points its `$schema`.
  schemaPath?: string;
}

// Archify's component types, in its legend order, with the name, tone and
// glyph each had there.
const TYPES: Record<string, { label: string; tone: Tone; icon: (typeof ICONS)[number] }> = {
  frontend: { label: 'Frontend', tone: 'blue', icon: 'window' },
  backend: { label: 'Backend', tone: 'green', icon: 'code' },
  database: { label: 'Database', tone: 'gold', icon: 'cylinder' },
  cloud: { label: 'Cloud', tone: 'orange', icon: 'cloud' },
  security: { label: 'Security', tone: 'red', icon: 'shield' },
  messagebus: { label: 'Message bus', tone: 'teal', icon: 'queue' },
  external: { label: 'External', tone: 'slate', icon: 'external' },
};
const EVIDENCE: Record<ArchifyNote['evidence'], { label: string; tone: Tone }> = {
  observed: { label: 'Observed', tone: 'green' },
  inferred: { label: 'Inferred', tone: 'gold' },
  hypothesis: { label: 'Hypothesis', tone: 'red' },
};
// Card dots by the colour Archify painted them.
const DOT_TONE: Record<string, Tone> = { cyan: 'blue', emerald: 'green', violet: 'gold', amber: 'orange', rose: 'red', orange: 'teal', slate: 'slate' };

// Archify's dataflow compiler grid.
const DATAFLOW = { leftX: 100, colGap: 215, stageW: 168, stageY: 46, stageBottomPad: 74, nodeW: 112, nodeH: 58, rowYs: [128, 242, 356, 470, 584] };

function slug(text: string) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// A readable id for an unnamed boundary or stage, unique within the diagram.
function uniqueId(label: string, prefix: string, taken: Set<string>) {
  const base = /^[a-z]/.test(slug(label)) ? slug(label).split('-').slice(0, 4).join('-') : `${prefix}-${slug(label) || 'x'}`;
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

// Archify notes are plain text; diagram notes are MDX. Escape what MDX reads
// as a tag or an expression, so `spark-<uuid>` stays as written.
const mdxText = (text: string) => text.replace(/[<{}]/g, (character) => `\\${character}`);

const defined = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

// The result is the file's content: defaults left out, checked against the schema.
export function importArchify(spec: ArchifySpec, options: ImportOptions = {}): DiagramInput {
  const taken = new Set<string>();
  const dataflow = spec.diagram_type === 'dataflow';
  const sourceNodes = (dataflow ? spec.nodes : spec.components) ?? [];
  const relations = (dataflow ? spec.flows : spec.connections) ?? [];
  for (const node of sourceNodes) taken.add(node.id);
  for (const relation of relations) if (relation.id) taken.add(relation.id);

  const stageX = (index: number) => DATAFLOW.leftX + index * DATAFLOW.colGap;
  const canvas: Pair | undefined = spec.meta.viewBox ?? (dataflow ? [
    Math.max(480, Math.ceil(Math.max(
      stageX((spec.stages?.length ?? 1) - 1) + DATAFLOW.stageW / 2,
      ...sourceNodes.map((node) => stageX(node.stage ?? 0) + (node.width ?? DATAFLOW.nodeW) / 2),
    ) + 24)),
    720,
  ] : undefined);

  const nodeBox = (node: ArchifyNode) => {
    if (!dataflow) return { x: node.pos![0], y: node.pos![1], w: node.size?.[0] ?? 120, h: node.size?.[1] ?? 60 };
    const w = node.width ?? DATAFLOW.nodeW;
    return { x: stageX(node.stage ?? 0) - w / 2, y: DATAFLOW.rowYs[node.row ?? 0] + (node.yOffset ?? 0), w, h: node.height ?? DATAFLOW.nodeH };
  };

  const groups = (spec.boundaries ?? []).map((boundary, index) => ({
    id: uniqueId(boundary.label, 'group', taken),
    label: boundary.label,
    security: boundary.kind === 'security-group',
    members: boundary.wraps,
    pad: boundary.pad,
    grow: options.growFrames?.[index],
  }));
  const lanes = (spec.stages ?? []).map((stage, index) => ({ id: uniqueId(stage.label, 'stage', taken), label: stage.label, index }));
  const edges = relations.map((relation, index) => ({
    id: relation.id ?? uniqueId(`${relation.from}-${relation.to}`, 'edge', taken),
    relation,
    index,
  }));

  const legend = spec.meta.legend;
  const used = new Set(sourceNodes.map((node) => node.type));
  const kindIds = new Map<string, string>();
  const kinds = Object.entries(TYPES).filter(([type]) => used.has(type)).map(([type, { label: name, tone, icon }]) => {
    const label = legend?.entries?.[type]?.label ?? name;
    const id = uniqueId(label, 'kind', taken);
    kindIds.set(type, id);
    return { id, label, tone, icon };
  });
  const evidence = new Set(Object.values(options.notes ?? {}).map((note) => note.evidence));
  const badges = (Object.keys(EVIDENCE) as ArchifyNote['evidence'][]).filter((level) => evidence.has(level))
    .map((level) => ({ id: level, ...EVIDENCE[level] }));

  const input: DiagramInput = {
    $schema: options.schemaPath,
    version: 1,
    title: spec.meta.title,
    kinds,
    badges,
    legend: legend?.mode === 'hidden' ? false : undefined,
    nodes: sourceNodes.map((node) => {
      const note = options.notes?.[node.id];
      return defined({
        id: node.id,
        kind: kindIds.get(node.type)!,
        label: node.label,
        sublabel: node.sublabel,
        tag: node.tag,
        note: note && defined({ role: mdxText(note.role), badge: note.evidence, points: note.points?.map(mdxText) }),
      });
    }),
    groups: groups.map(({ id, label, security, members }) => defined({
      id,
      label,
      tone: security ? 'red' as const : undefined,
      dashed: security || undefined,
      members,
    })),
    edges: edges.map(({ id, relation }) => defined({
      id,
      from: relation.from,
      to: relation.to,
      label: relation.label,
      detail: relation.classification,
      variant: relation.variant === 'security' ? 'alert' as const
        : relation.variant && relation.variant !== 'default' ? relation.variant as EdgeVariant : undefined,
    })),
    lanes: lanes.map(({ id, label }) => ({ id, label })),
    cards: (spec.cards ?? []).map((card) => {
      const tone = DOT_TONE[card.dot ?? 'cyan'];
      return defined({ title: card.title, tone: tone === 'blue' ? undefined : tone, items: card.items.map(mdxText) });
    }),
    layout: defined({
      canvas,
      nodes: Object.fromEntries(sourceNodes.map((node) => [node.id, nodeBox(node)])),
      groups: Object.fromEntries(groups.filter(({ pad, grow }) => pad !== undefined || grow !== undefined)
        .map(({ id, pad, grow }) => [id, defined({ pad, grow })])),
      edges: Object.fromEntries(edges.flatMap(({ id, relation }) => {
        const placement = defined({
          fromSide: relation.fromSide as 'top' | undefined,
          toSide: relation.toSide as 'top' | undefined,
          via: relation.via,
          labelAt: relation.labelAt,
          labelDx: relation.labelDx,
          labelDy: relation.labelDy,
        });
        return Object.keys(placement).length ? [[id, placement]] : [];
      })),
      lanes: lanes.length ? Object.fromEntries(lanes.map(({ id, index }) => [id, {
        x: stageX(index) - DATAFLOW.stageW / 2,
        y: DATAFLOW.stageY,
        w: DATAFLOW.stageW,
        h: canvas![1] - DATAFLOW.stageY - DATAFLOW.stageBottomPad,
      }])) : undefined,
    }),
  };
  for (const key of ['badges', 'groups', 'edges', 'lanes', 'cards'] as const) if (!input[key]?.length) delete input[key];
  if (!Object.keys(input.layout.groups ?? {}).length) delete input.layout.groups;
  if (!Object.keys(input.layout.edges ?? {}).length) delete input.layout.edges;
  if (input.$schema === undefined) delete input.$schema;
  if (input.legend === undefined) delete input.legend;
  diagramSchema.parse(input);
  return input;
}
