// The legend lens: picking an entry of a diagram's legend keeps what it
// names lit and dims the rest. An architecture or lifecycle legend lists
// node kinds: the kind's nodes stay lit, with every edge that touches one.
// A sequence legend lists message variants: the variant's messages stay
// lit, with the participants at their ends.

import type { Scene } from '#layout/scene.ts';

export type LensGraph = {
  by: 'kind' | 'variant';
  // The legend entries a reader can pick, in legend order.
  entries: { value: string; label: string }[];
  nodes: { id: string; kind: string }[];
  edges: { id: string; from: string; to: string; variant: string }[];
}

export type LensMarks = {
  nodes: Set<string>;
  edges: Set<string>;
}

// What the viewer needs to run the lens on a drawn scene; null when the
// drawing has no legend to pick from. The initial and final markers of a
// lifecycle legend name no kind, so they are not entries.
export function lensGraph(scene: Scene): LensGraph | null {
  const entries = (scene.legend?.entries ?? []).filter((entry) => !entry.mark);
  if (!entries.length) return null;
  return {
    by: entries.some((entry) => entry.variant) ? 'variant' : 'kind',
    entries: entries.map((entry) => ({ value: entry.variant ?? entry.kind, label: entry.label })),
    nodes: scene.nodes.map(({ node }) => ({ id: node.id, kind: node.kind })),
    edges: scene.edges.map(({ edge }) => ({ id: edge.id, from: edge.from, to: edge.to, variant: edge.variant })),
  };
}

export function lensMarks(graph: LensGraph, value: string): LensMarks {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  if (graph.by === 'variant') {
    for (const edge of graph.edges) {
      if (edge.variant !== value) continue;
      edges.add(edge.id);
      nodes.add(edge.from).add(edge.to);
    }
    return { nodes, edges };
  }
  for (const node of graph.nodes) if (node.kind === value) nodes.add(node.id);
  for (const edge of graph.edges) if (nodes.has(edge.from) || nodes.has(edge.to)) edges.add(edge.id);
  return { nodes, edges };
}
