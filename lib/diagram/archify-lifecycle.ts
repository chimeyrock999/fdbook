// Archify lifecycle specs (schema v3) both ways. importArchifyLifecycle
// turns one into a diagram: states become nodes with a kind per Archify
// state type (named and toned as its legend had them), transitions become
// edges, a note becomes the transition's detail. A state's `step` is not
// kept: a diagram has no step rail. lifecycleSpecOf turns a diagram back
// into a spec Archify draws, for the parity fixture (scripts/archify-fixtures.ts).

import { DOT_TONE, defined, mdxText, uniqueId } from './import-archify.ts';
import { diagramSchema, type Diagram, type DiagramInput, type EdgeVariant, type ICONS, type Tone } from './schema.ts';

export interface ArchifyLifecycleSpec {
  schema_version?: 3;
  diagram_type: 'lifecycle';
  meta: { title: string; output?: string; quality_profile?: string; legend?: { mode?: string } };
  mainPath: string[];
  states: { id: string; type: string; label: string; sublabel?: string; tag?: string; step?: string }[];
  transitions: { id?: string; from: string; to: string; label?: string; note?: string; variant?: string }[];
  cards?: { dot?: string; title: string; items: string[] }[];
}

// Archify's state types, in its legend order, with the name, tone and
// corner glyph each has there; the quiet ones have none.
export const LIFECYCLE_TYPES: Record<string, { label: string; tone: Tone; icon?: (typeof ICONS)[number] }> = {
  start: { label: 'Initial', tone: 'blue' },
  active: { label: 'Active', tone: 'teal' },
  waiting: { label: 'Waiting', tone: 'orange', icon: 'hourglass' },
  decision: { label: 'Decision', tone: 'gold', icon: 'diamond' },
  success: { label: 'Success', tone: 'green', icon: 'check' },
  failure: { label: 'Failure / exit', tone: 'red', icon: 'cross' },
  neutral: { label: 'Neutral', tone: 'slate' },
  external: { label: 'External', tone: 'slate', icon: 'external' },
};

// A main-path transition is emphasised unless it says otherwise; here it
// always is (a variant cannot say "default" apart from leaving it out).
const VARIANT_IN: Record<string, EdgeVariant | undefined> = { security: 'alert', emphasis: 'emphasis', dashed: 'dashed' };
// Archify's lifecycle has no reply line; a return is drawn like a dashed one.
const VARIANT_OUT: Record<EdgeVariant, string> = { default: 'default', emphasis: 'emphasis', alert: 'security', dashed: 'dashed', return: 'dashed' };

export function importArchifyLifecycle(spec: ArchifyLifecycleSpec, { schemaPath }: { schemaPath?: string } = {}): DiagramInput {
  const taken = new Set<string>([...spec.states.map((state) => state.id), ...spec.transitions.flatMap((transition) => (transition.id ? [transition.id] : []))]);
  const used = new Set(spec.states.map((state) => state.type));
  const kindIds = new Map<string, string>();
  const kinds = Object.entries(LIFECYCLE_TYPES).filter(([type]) => used.has(type)).map(([type, { label, tone, icon }]) => {
    const id = uniqueId(label, 'kind', taken);
    kindIds.set(type, id);
    return defined({ id, label, tone, icon });
  });
  const input: DiagramInput = {
    $schema: schemaPath,
    version: 1,
    type: 'lifecycle',
    title: spec.meta.title,
    kinds,
    legend: spec.meta.legend?.mode === 'hidden' ? false : undefined,
    mainPath: spec.mainPath,
    nodes: spec.states.map((state) => defined({
      id: state.id,
      kind: kindIds.get(state.type)!,
      label: state.label,
      sublabel: state.sublabel || undefined,
      tag: state.tag || undefined,
    })),
    edges: spec.transitions.map((transition) => defined({
      id: transition.id ?? uniqueId(`${transition.from}-${transition.to}`, 'transition', taken),
      from: transition.from,
      to: transition.to,
      label: transition.label || undefined,
      detail: transition.note || undefined,
      variant: VARIANT_IN[transition.variant ?? ''],
    })),
    cards: (spec.cards ?? []).map((card) => {
      const tone = DOT_TONE[card.dot ?? 'cyan'];
      return defined({ title: card.title, tone: tone === 'blue' ? undefined : tone, items: card.items.map(mdxText) });
    }),
  };
  if (!input.cards?.length) delete input.cards;
  if (input.$schema === undefined) delete input.$schema;
  if (input.legend === undefined) delete input.legend;
  diagramSchema.parse(input);
  return input;
}

// A spec Archify lays out as the diagram is: the same states (their type
// changes only colours and glyphs), transitions and main path, with the
// legend hidden; the parity test compares the diagram drawn without one.
export function lifecycleSpecOf(diagram: Diagram): ArchifyLifecycleSpec {
  return {
    schema_version: 3,
    diagram_type: 'lifecycle',
    meta: { title: diagram.title, output: 'out.html', quality_profile: 'showcase', legend: { mode: 'hidden' } },
    mainPath: diagram.mainPath,
    states: diagram.nodes.map((node) => defined({ id: node.id, type: 'neutral', label: node.label, sublabel: node.sublabel, tag: node.tag })),
    transitions: diagram.edges.map((edge) => defined({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: edge.label,
      note: edge.detail,
      variant: edge.variant === 'default' ? undefined : VARIANT_OUT[edge.variant],
    })),
  };
}
