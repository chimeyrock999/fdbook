import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatDiagramJson } from '@fdbook/diagram/format.ts';
import { validateDiagram } from '@fdbook/diagram/validate.ts';
import { describe, expect, it } from 'vitest';
import {
  addCard,
  addKind,
  addGroup,
  addNodeAt,
  connectAt,
  duplicateCard,
  duplicateGroup,
  duplicateNodes,
  freeId,
  freeSpot,
  groupNodes,
  moveNodes,
  placeNode,
  removeCard,
  removeEdge,
  removeGroup,
  removeKind,
  setEdgeSides,
  setWaypoints,
  snap,
  updateNode,
  type Input,
} from '#diagrams/edits.ts';
import { placeCopy } from '#diagrams/placement.ts';

// A layout the test knows is there.
function layoutOf(doc: Input) {
  if (!doc.layout) throw new Error('no layout');
  return doc.layout;
}

const PATH = 'diagrams/data-platform/processing/apache-spark/spark-logic-to-execution.diagram.json';
// The repository root, from studio/tests/src/diagrams.
const text = readFileSync(join(import.meta.dirname, '../../../..', PATH), 'utf8');
const real = () => JSON.parse(text) as Input;
const FRAME = 'spark-application-runtime-boundary';

// Every edit leaves a diagram the site still draws, with no new error.
function draws(diagram: Input) {
  const { scene, issues } = validateDiagram(diagram);
  expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  if (!scene) throw new Error('the diagram does not draw');
  return scene;
}

// No error the original did not have.
function noNewErrors(before: Input, after: Input) {
  const errors = (diagram: Input) => validateDiagram(diagram).issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code);
  expect(errors(after)).toEqual(errors(before));
}

const RUNTIME = 'diagrams/data-platform/stacks-integration/databricks/databricks-interactive-runtime/runtime-architecture-from-process-signals.diagram.json';
const runtime = () => JSON.parse(readFileSync(join(import.meta.dirname, '../../../..', RUNTIME), 'utf8')) as Input;

// The lines of the formatted file that differ.
function changedLines(before: Input, after: Input) {
  const a = formatDiagramJson(before).split('\n');
  const b = formatDiagramJson(after).split('\n');
  return b.filter((line, index) => line !== a[index]);
}

describe('diagram edits', () => {
  it('moves a node onto the grid, changing one line of the file', () => {
    const next = placeNode(real(), 'plan', 563, 131);
    expect(layoutOf(next).nodes.plan).toEqual({ x: 560, y: 128, w: 190, h: 68 });
    expect(changedLines(real(), next)).toEqual(['      "plan": { "x": 560, "y": 128, "w": 190, "h": 68 },']);
    draws(next);
  });

  it('moves several nodes by the same snapped step, and the frame follows its members', () => {
    const before = draws(real()).frames[0];
    const next = moveNodes(real(), groupNodes(real(), FRAME), 37, 3);
    expect(layoutOf(next).nodes.ops).toMatchObject({ x: 336, y: 120 });
    expect(layoutOf(next).nodes.units).toMatchObject({ x: 856, y: 300 });
    expect(layoutOf(next).nodes.logic).toMatchObject({ x: 40 });
    const after = draws(next).frames[0];
    expect(after.x - before.x).toBe(36);
    expect(after.width).toBe(before.width);
  });

  it('adds a node of the first kind on the grid, with an id of its own', () => {
    const { diagram, id } = addNodeAt(real(), { x: 43, y: 357 });
    expect(id).toBe('node');
    expect(diagram.nodes.at(-1)).toEqual({ id: 'node', kind: 'backend', label: 'New node' });
    expect(layoutOf(diagram).nodes.node).toEqual({ x: 40, y: 360, w: 160, h: 64 });
    expect(addNodeAt(diagram, { x: 0, y: 0 }).id).toBe('node-2');
    draws(diagram);
  });

  it('finds room for a new node inside the drawing, below it when there is none', () => {
    const scene = draws(real());
    const taken = [...scene.nodes, ...scene.frames];
    const spot = freeSpot(taken, scene.width, scene.height);
    const { diagram, id } = addNodeAt(real(), spot);
    const after = draws(diagram);
    expect([after.width, after.height]).toEqual([scene.width, scene.height]);
    expect(after.nodes.find((node) => node.node.id === id)).toMatchObject({ x: spot.x, y: spot.y });
    const full = [{ x: 0, y: 0, width: scene.width, height: scene.height }];
    expect(freeSpot(full, scene.width, scene.height)).toEqual({ x: 40, y: snap(scene.height + 24) });
  });

  it('duplicates nodes inside the frame that holds them, clear of the rest, with the edges between them', () => {
    const { diagram, ids } = duplicateNodes(real(), ['plan', 'physical'], placeCopy(real(), draws(real()), { nodes: ['plan', 'physical'] }));
    expect(ids).toEqual(['plan-2', 'physical-2']);
    expect(diagram.groups?.[0].members).toEqual(['ops', 'plan', 'physical', 'units', 'plan-2', 'physical-2']);
    expect(layoutOf(diagram).nodes['plan-2']).toMatchObject({ w: 190, h: 68 });
    // The pair keeps its spacing.
    expect(layoutOf(diagram).nodes['physical-2'].x - layoutOf(diagram).nodes['plan-2'].x).toBe(260);
    expect(diagram.edges?.at(-1)).toMatchObject({ from: 'plan-2', to: 'physical-2', label: real().edges?.find((edge) => edge.id === 'optimize')?.label });
    expect(diagram.nodes.find((node) => node.id === 'plan-2')?.note).toEqual(real().nodes.find((node) => node.id === 'plan')?.note);
    noNewErrors(real(), diagram);
  });

  it('duplicates a node with no room in its frame outside every frame', () => {
    const { diagram, ids } = duplicateNodes(real(), ['logic'], placeCopy(real(), draws(real()), { nodes: ['logic'] }));
    expect(diagram.groups?.[0].members).not.toContain(ids[0]);
    noNewErrors(real(), diagram);
  });

  it('wraps nodes in a new frame inside the one that holds them, and removes it again', () => {
    const { diagram, id } = addGroup(real(), ['plan', 'physical']);
    expect(id).toBe('frame');
    expect(diagram.groups?.find((group) => group.id === FRAME)?.members).toEqual(['ops', 'units', 'frame']);
    expect(groupNodes(diagram, FRAME).sort()).toEqual(['ops', 'physical', 'plan', 'units']);
    draws(diagram);
    const back = removeGroup(diagram, id);
    expect(back.groups?.find((group) => group.id === FRAME)?.members.sort()).toEqual(['ops', 'physical', 'plan', 'units']);
    expect(back.groups).toHaveLength(1);
  });

  it('removes a frame with the edges that end on it, keeping its nodes', () => {
    const { diagram } = connectAt(real(), 'logic', FRAME, 'right', 'left');
    const next = removeGroup(diagram, FRAME);
    expect(next.groups).toEqual([]);
    expect(next.nodes).toHaveLength(6);
    expect(next.edges?.some((edge) => edge.to === FRAME)).toBe(false);
    expect(layoutOf(next).edges?.['logic-spark-application-runtime-boundary']).toBeUndefined();
  });

  it('duplicates a frame around copies of its nodes, clear of the drawing', () => {
    const { diagram, id } = duplicateGroup(real(), FRAME, placeCopy(real(), draws(real()), { group: FRAME }));
    expect(id).toBe(`${FRAME}-2`);
    const copy = diagram.groups?.find((group) => group.id === id);
    expect(copy?.members).toEqual(['ops-2', 'plan-2', 'physical-2', 'units-2']);
    expect(diagram.groups?.find((group) => group.id === FRAME)?.members).toEqual(['ops', 'plan', 'physical', 'units']);
    noNewErrors(real(), diagram);
  });

  it('keeps the copy of a frame out of the frames inside the original', () => {
    const doc = runtime();
    const frame = 'driver-node-one-machine';
    const { diagram, id } = duplicateGroup(doc, frame, placeCopy(doc, draws(doc), { group: frame }));
    const copies = groupNodes(diagram, id);
    expect(copies.length).toBe(groupNodes(doc, frame).length);
    for (const group of doc.groups ?? []) {
      if (group.id === frame) continue;
      expect(diagram.groups?.find((each) => each.id === group.id)?.members, group.id).toEqual(group.members);
    }
    noNewErrors(doc, diagram);
  });

  // Every node and every frame of the repository's diagrams, one at a time.
  // A sequence or lifecycle copies nothing (SequenceCanvas.test.tsx, LifecycleCanvas.test.tsx).
  const architectures = globSync('diagrams/**/*.diagram.json', { cwd: join(import.meta.dirname, '../../../..') })
    .filter((path) => ((JSON.parse(readFileSync(join(import.meta.dirname, '../../../..', path), 'utf8')) as Input).type ?? 'architecture') === 'architecture');
  it.each(architectures)('duplicates anything in %s without a new error', (path) => {
    const doc = JSON.parse(readFileSync(join(import.meta.dirname, '../../../..', path), 'utf8')) as Input;
    const scene = draws(doc);
    for (const node of doc.nodes) noNewErrors(doc, duplicateNodes(doc, [node.id], placeCopy(doc, scene, { nodes: [node.id] })).diagram);
    for (const group of doc.groups ?? []) noNewErrors(doc, duplicateGroup(doc, group.id, placeCopy(doc, scene, { group: group.id })).diagram);
  }, 30_000);

  it('connects two nodes from the sides they were drawn between', () => {
    const { diagram, id } = connectAt(real(), 'logic', 'executors', 'bottom', 'left');
    expect(id).toBe('logic-executors');
    expect(diagram.edges?.at(-1)).toEqual({ id: 'logic-executors', from: 'logic', to: 'executors' });
    expect(layoutOf(diagram).edges?.[id]).toEqual({ fromSide: 'bottom', toSide: 'left' });
    const edge = draws(diagram).edges.find((each) => each.edge.id === id);
    expect(edge?.points[0]).toEqual([135, 188]);
    expect(removeEdge(diagram, id)).toEqual(real());
  });

  it('pins waypoints on the grid and clears them to route again', () => {
    const next = setWaypoints(real(), 'submit', [[251, 141], [251, 170]]);
    expect(layoutOf(next).edges?.submit).toEqual({ via: [[248, 144], [248, 168]] });
    const edge = draws(next).edges.find((each) => each.edge.id === 'submit');
    expect(edge?.points.slice(1, -1)).toEqual([[248, 144], [248, 168]]);
    expect(edge?.automatic).toBe(false);
    expect(setWaypoints(next, 'submit', null)).toEqual(real());
    // Other layout of the edge stays.
    expect(layoutOf(setWaypoints(setWaypoints(real(), 'schedule', [[900, 400]]), 'schedule', null)).edges?.schedule).toEqual({ fromSide: 'bottom', toSide: 'top', labelDy: 24 });
  });

  it('sets and clears end sides', () => {
    const next = setEdgeSides(real(), 'submit', { fromSide: 'bottom' });
    expect(layoutOf(next).edges?.submit).toEqual({ fromSide: 'bottom' });
    expect(setEdgeSides(next, 'submit', { fromSide: undefined })).toEqual(real());
  });

  it('removes a field set to nothing', () => {
    const next = updateNode(real(), 'plan', { sublabel: '', tag: 'v2' });
    const plan = next.nodes.find((node) => node.id === 'plan');
    expect(plan?.sublabel).toBeUndefined();
    expect(plan?.tag).toBe('v2');
  });

  it('adds, duplicates and removes cards', () => {
    const added = addCard(real());
    expect(added.cards).toHaveLength(4);
    expect(added.cards?.at(-1)).toEqual({ title: 'New card', items: ['One line.'] });
    const twice = duplicateCard(real(), 0);
    expect(twice.cards?.[1]).toEqual(real().cards?.[0]);
    expect(removeCard(twice, 1)).toEqual(real());
    draws(added);
  });

  it('adds a kind, for a node or alone, and removes only an unused one', () => {
    const { diagram, id } = addKind(real(), 'plan');
    expect(id).toBe('kind');
    expect(diagram.kinds.at(-1)).toEqual({ id: 'kind', label: 'New kind', tone: 'blue' });
    expect(diagram.nodes.find((node) => node.id === 'plan')?.kind).toBe('kind');
    expect(draws(diagram).legend?.entries.map((entry) => entry.label)).toContain('New kind');
    expect(removeKind(diagram, 'kind')).toBe(diagram);
    expect(removeKind(addKind(real()).diagram, 'kind')).toEqual(real());
  });

  it('numbers an id that is taken', () => {
    expect(freeId(real(), 'plan')).toBe('plan-2');
    expect(freeId(real(), 'fresh')).toBe('fresh');
  });
});
