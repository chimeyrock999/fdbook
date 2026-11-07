// The checks a lifecycle gets besides the shared ones in validate.ts: what a
// lifecycle cannot hold (frames, lanes, positions, sequence ranges), its main
// path, and Archify's checks of render-lifecycle.mjs (state text, the canvas
// width, labels that found no clear spot, crowded neighbours).

import { availableTextWidth, minimumTextWidth } from '#layout/geometry.ts';
import { STATE_MAX_W, TEXT, stateTextFits, type LifecycleLayer } from '#layout/lifecycle.ts';
import type { Scene } from '#layout/scene.ts';
import type { Diagram } from '#model/schema.ts';
import type { DiagramIssue } from './validate.ts';

// The main-path steps with no transition into them from the step before,
// among the states the diagram has; the Studio's panel names the same ones.
export function mainPathGaps(diagram: { mainPath?: string[]; nodes: { id: string }[]; edges?: { from: string; to: string }[] }) {
  const ids = new Set(diagram.nodes.map((node) => node.id));
  const path = diagram.mainPath ?? [];
  return path.slice(0, -1).flatMap((from, index) => {
    const to = path[index + 1];
    return ids.has(from) && ids.has(to) && !(diagram.edges ?? []).some((edge) => edge.from === from && edge.to === to) ? [{ from, to, index }] : [];
  });
}

export function checkLifecycleStructure(diagram: Diagram): DiagramIssue[] {
  const issues: DiagramIssue[] = [];
  const error = (code: string, message: string, fix?: string, path?: string) => issues.push({ code, severity: 'error', message, fix, path });
  const unused = 'a lifecycle lays itself out from its main path and transitions';
  if (diagram.groups.length) error('lifecycle/no-groups', 'A lifecycle has no frames; phases several exits share get one from the layout.', `remove groups (${unused})`, 'groups');
  if (diagram.lanes.length) error('lifecycle/no-lanes', 'A lifecycle has no lanes.', 'remove lanes', 'lanes');
  if (Object.keys(diagram.layout).some((key) => key !== 'nodes') || Object.keys(diagram.layout.nodes).length) {
    error('lifecycle/no-layout', 'A lifecycle places everything itself; layout does not apply.', `remove layout (${unused})`, 'layout');
  }
  if (diagram.segments.length || diagram.activations.length) {
    error('structure/sequence-only', 'Segments and activations belong to a sequence.', 'remove them', diagram.segments.length ? 'segments' : 'activations');
  }
  const ids = new Set(diagram.nodes.map((node) => node.id));
  const known = diagram.nodes.slice(0, 3).map((node) => `"${node.id}"`).join(', ');
  if (diagram.mainPath.length < 2) {
    error('lifecycle/main-path-too-short', 'A lifecycle needs a main path of two states or more: the happy path from the initial state.', 'list the happy path\'s states in mainPath, in order', 'mainPath');
  }
  diagram.mainPath.forEach((id, index) => {
    if (!ids.has(id)) error('lifecycle/unknown-main-path-state', `mainPath[${String(index)}] "${id}" is not a state.`, `name a state id, such as ${known}`, `mainPath[${String(index)}]`);
  });
  if (new Set(diagram.mainPath).size !== diagram.mainPath.length) {
    error('lifecycle/repeated-main-path-state', 'mainPath lists a state more than once; a return to an earlier phase is a transition, not a repeated step.', 'list each state once and keep the return as a transition', 'mainPath');
  }
  diagram.edges.forEach((edge, index) => {
    if (edge.bidirectional) error('lifecycle/two-way-transition', `Transition "${edge.id}" has heads at both ends; a transition goes one way.`, 'add the way back as its own transition', `edges[${String(index)}].bidirectional`);
  });
  for (const { from, to, index } of mainPathGaps(diagram)) {
    error('lifecycle/main-path-gap', `The main path steps from "${from}" to "${to}" with no transition between them.`,
      `add a transition from "${from}" to "${to}", or take the state out of mainPath if it is not on the happy path`, `mainPath[${String(index)}]`);
  }
  diagram.nodes.forEach((node, index) => {
    for (const [field, minimum] of [['label', TEXT.labelMinimum], ['sublabel', TEXT.sublabelMinimum], ['tag', TEXT.tagMinimum]] as const) {
      const value = node[field];
      if (value && !stateTextFits(value, minimum)) {
        error('lifecycle/state-text-too-long', `The ${field} of state "${node.id}" needs ~${String(Math.ceil(minimumTextWidth(value, minimum)))}px at ${String(minimum)}px, but the widest state (${String(STATE_MAX_W)}px) gives ${String(availableTextWidth(STATE_MAX_W))}px.`,
          `shorten the ${field}; move the detail into the note or a card`, `nodes[${String(index)}].${field}`);
      }
    }
  });
  return issues;
}

export function checkLifecycleScene(scene: Scene, layer: LifecycleLayer): DiagramIssue[] {
  const issues: DiagramIssue[] = [];
  const edgeIndex = new Map(scene.diagram.edges.map((edge, index) => [edge.id, index]));
  if (scene.width > layer.readableWidth) {
    issues.push({
      code: 'lifecycle/too-wide', severity: 'error',
      message: `The lifecycle is ${String(scene.width)}px wide; at ${String(layer.smallestText)}px text it reads at desktop width only up to ${String(layer.readableWidth)}px.`,
      fix: 'shorten state labels or transition labels on the main path, move secondary phases off mainPath, or split the lifecycle in two',
      path: 'mainPath',
    });
  }
  for (const id of layer.unplacedLabels) {
    const index = edgeIndex.get(id);
    if (index === undefined) throw new Error(`lifecycle check: unplaced label "${id}" is no transition`);
    const edge = scene.diagram.edges[index];
    issues.push({
      code: 'lifecycle/label-unplaced', severity: 'error',
      message: `The label of transition "${id}" (${edge.from} → ${edge.to}) finds no spot clear of the routes around it.`,
      fix: 'shorten its label or detail; keep every condition, or move the detail to a card',
      path: `edges[${String(index)}].label`,
    });
  }
  for (const [from, to] of layer.crowded) {
    issues.push({
      code: 'lifecycle/crowded-side-transitions', severity: 'error',
      message: `More than five transitions run between the neighbouring states "${from}" and "${to}"; at most five stay legible.`,
      fix: 'merge the triggers into one transition label',
      path: 'edges',
    });
  }
  if (scene.legendUnfit) {
    issues.push({ code: 'legend/unfit', severity: 'warning', message: 'The legend does not fit below the diagram, so it is hidden.', fix: 'set "legend": false', path: 'legend' });
  }
  return issues;
}
