import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatDiagramJson } from '@site/lib/diagram/format';
import { validateDiagram } from '@site/lib/diagram/validate';
import { describe, expect, it } from 'vitest';
import {
  addCard,
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
  setEdgeSides,
  setWaypoints,
  snap,
  updateNode,
  type Input,
} from '../../../src/diagrams/edits';

const PATH = 'diagrams/data-platform/processing/apache-spark/spark-logic-to-execution.diagram.json';
// The repository root, from tools/notes-studio/tests/src/diagrams.
const text = readFileSync(join(import.meta.dirname, '../../../../..', PATH), 'utf8');
const real = () => JSON.parse(text) as Input;
const FRAME = 'spark-application-runtime-boundary';

// Every edit leaves a diagram the site still draws, with no new error.
function draws(diagram: Input) {
  const { scene, issues } = validateDiagram(diagram);
  expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  if (!scene) throw new Error('the diagram does not draw');
  return scene;
}

// The lines of the formatted file that differ.
function changedLines(before: Input, after: Input) {
  const a = formatDiagramJson(before).split('\n');
  const b = formatDiagramJson(after).split('\n');
  return b.filter((line, index) => line !== a[index]);
}

describe('diagram edits', () => {
  it('moves a node onto the grid, changing one line of the file', () => {
    const next = placeNode(real(), 'plan', 563, 131);
    expect(next.layout.nodes.plan).toEqual({ x: 560, y: 128, w: 190, h: 68 });
    expect(changedLines(real(), next)).toEqual(['      "plan": { "x": 560, "y": 128, "w": 190, "h": 68 },']);
    draws(next);
  });

  it('moves several nodes by the same snapped step, and the frame follows its members', () => {
    const before = draws(real()).frames[0];
    const next = moveNodes(real(), groupNodes(real(), FRAME), 37, 3);
    expect(next.layout.nodes.ops).toMatchObject({ x: 336, y: 120 });
    expect(next.layout.nodes.units).toMatchObject({ x: 856, y: 300 });
    expect(next.layout.nodes.logic).toMatchObject({ x: 40 });
    const after = draws(next).frames[0];
    expect(after.x - before.x).toBe(36);
    expect(after.width).toBe(before.width);
  });

  it('adds a node of the first kind on the grid, with an id of its own', () => {
    const { diagram, id } = addNodeAt(real(), { x: 43, y: 357 });
    expect(id).toBe('node');
    expect(diagram.nodes.at(-1)).toEqual({ id: 'node', kind: 'backend', label: 'New node' });
    expect(diagram.layout.nodes.node).toEqual({ x: 40, y: 360, w: 160, h: 64 });
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

  it('duplicates nodes beside them, in their frames, with the edges between them', () => {
    const { diagram, ids } = duplicateNodes(real(), ['plan', 'physical']);
    expect(ids).toEqual(['plan-2', 'physical-2']);
    expect(diagram.layout.nodes['plan-2']).toEqual({ x: 584, y: 144, w: 190, h: 68 });
    expect(diagram.groups?.[0].members).toEqual(['ops', 'plan', 'physical', 'units', 'plan-2', 'physical-2']);
    expect(diagram.edges?.at(-1)).toMatchObject({ from: 'plan-2', to: 'physical-2', label: real().edges?.find((edge) => edge.id === 'optimize')?.label });
    expect(diagram.nodes.find((node) => node.id === 'plan-2')?.note).toEqual(real().nodes.find((node) => node.id === 'plan')?.note);
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
    expect(next.layout.edges?.['logic-spark-application-runtime-boundary']).toBeUndefined();
  });

  it('duplicates a frame around copies of its nodes, beside it', () => {
    const { diagram, id } = duplicateGroup(real(), FRAME);
    expect(id).toBe(`${FRAME}-2`);
    const copy = diagram.groups?.find((group) => group.id === id);
    expect(copy?.members).toEqual(['ops-2', 'plan-2', 'physical-2', 'units-2']);
    expect(diagram.groups?.find((group) => group.id === FRAME)?.members).toEqual(['ops', 'plan', 'physical', 'units']);
    expect(diagram.layout.nodes['ops-2']).toMatchObject({ x: 324, y: 144 });
  });

  it('connects two nodes from the sides they were drawn between', () => {
    const { diagram, id } = connectAt(real(), 'logic', 'executors', 'bottom', 'left');
    expect(id).toBe('logic-executors');
    expect(diagram.edges?.at(-1)).toEqual({ id: 'logic-executors', from: 'logic', to: 'executors' });
    expect(diagram.layout.edges?.[id]).toEqual({ fromSide: 'bottom', toSide: 'left' });
    const edge = draws(diagram).edges.find((each) => each.edge.id === id);
    expect(edge?.points[0]).toEqual([135, 188]);
    expect(removeEdge(diagram, id)).toEqual(real());
  });

  it('pins waypoints on the grid and clears them to route again', () => {
    const next = setWaypoints(real(), 'submit', [[251, 141], [251, 170]]);
    expect(next.layout.edges?.submit).toEqual({ via: [[248, 144], [248, 168]] });
    const edge = draws(next).edges.find((each) => each.edge.id === 'submit');
    expect(edge?.points.slice(1, -1)).toEqual([[248, 144], [248, 168]]);
    expect(edge?.automatic).toBe(false);
    expect(setWaypoints(next, 'submit', null)).toEqual(real());
    // Other layout of the edge stays.
    expect(setWaypoints(setWaypoints(real(), 'schedule', [[900, 400]]), 'schedule', null).layout.edges?.schedule).toEqual({ fromSide: 'bottom', toSide: 'top', labelDy: 24 });
  });

  it('sets and clears end sides', () => {
    const next = setEdgeSides(real(), 'submit', { fromSide: 'bottom' });
    expect(next.layout.edges?.submit).toEqual({ fromSide: 'bottom' });
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

  it('numbers an id that is taken', () => {
    expect(freeId(real(), 'plan')).toBe('plan-2');
    expect(freeId(real(), 'fresh')).toBe('fresh');
  });
});
