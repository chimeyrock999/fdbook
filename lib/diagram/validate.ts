// Checks a diagram can be drawn and reads well, with a stable code and a fix
// for each problem: structure first (ids, members, ends, positions), then the
// drawn geometry (overlaps, frames, labels, text that cannot fit). The text
// and overlap limits are Archify's (render-architecture.mjs validation).

import { ZodError } from 'zod';
import { rectsOverlap, textUnits, type Rect } from './geometry.ts';
import { buildScene, groupNodeIds, type Scene } from './scene.ts';
import { diagramSchema, type Diagram } from './schema.ts';

export interface DiagramIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  fix?: string;
}

const contains = (outer: Rect, inner: Rect) => outer.x <= inner.x + 1e-9 && outer.y <= inner.y + 1e-9
  && outer.x + outer.width + 1e-9 >= inner.x + inner.width && outer.y + outer.height + 1e-9 >= inner.y + inner.height;

export function checkStructure(diagram: Diagram): DiagramIssue[] {
  const issues: DiagramIssue[] = [];
  const error = (code: string, message: string, fix?: string) => issues.push({ code, severity: 'error', message, fix });
  const seen = new Map<string, string>();
  for (const [kind, items] of [['kind', diagram.kinds], ['badge', diagram.badges], ['node', diagram.nodes], ['group', diagram.groups], ['edge', diagram.edges], ['lane', diagram.lanes]] as const) {
    for (const { id } of items) {
      if (seen.has(id)) error('structure/duplicate-id', `The id "${id}" names both a ${seen.get(id)} and a ${kind}.`, `rename one of them`);
      else seen.set(id, kind);
    }
  }
  const nodeIds = new Set(diagram.nodes.map((node) => node.id));
  const groupIds = new Set(diagram.groups.map((group) => group.id));
  const kindIds = new Set(diagram.kinds.map((kind) => kind.id));
  const badgeIds = new Set(diagram.badges.map((badge) => badge.id));
  for (const node of diagram.nodes) {
    if (!kindIds.has(node.kind)) {
      error('structure/unknown-kind', `Node "${node.id}" is of kind "${node.kind}", which the diagram does not list in kinds.`, `add { "id": "${node.kind}", "label": …, "tone": … } to kinds`);
    }
    if (node.note?.badge && !badgeIds.has(node.note.badge)) {
      error('structure/unknown-badge', `The note of "${node.id}" has badge "${node.note.badge}", which the diagram does not list in badges.`, `add { "id": "${node.note.badge}", "label": …, "tone": … } to badges`);
    }
  }
  for (const kind of diagram.kinds) {
    if (!diagram.nodes.some((node) => node.kind === kind.id)) {
      issues.push({ code: 'structure/unused-kind', severity: 'warning', message: `No node is of kind "${kind.id}".`, fix: `remove "${kind.id}" from kinds` });
    }
  }
  for (const group of diagram.groups) {
    for (const member of group.members) {
      if (!nodeIds.has(member) && !groupIds.has(member)) {
        error('structure/unknown-member', `Group "${group.id}" lists "${member}", which is no node or group.`, `remove "${member}" from its members or add that node`);
      }
    }
    const reaches = (id: string, path: Set<string>): boolean => diagram.groups.find((other) => other.id === id)?.members
      .some((member) => member === group.id || (groupIds.has(member) && !path.has(member) && reaches(member, new Set([...path, member])))) ?? false;
    if (reaches(group.id, new Set([group.id]))) {
      error('structure/group-cycle', `Group "${group.id}" contains itself through its member groups.`, 'list the nodes instead of the outer group');
    }
  }
  for (const edge of diagram.edges) {
    for (const end of [edge.from, edge.to]) {
      if (!nodeIds.has(end) && !groupIds.has(end)) {
        error('structure/unknown-endpoint', `Edge "${edge.id}" ends at "${end}", which is no node or group.`, `point the edge at an existing node or group id`);
      }
    }
    if (edge.from === edge.to) error('structure/self-loop', `Edge "${edge.id}" starts and ends at "${edge.from}".`, 'remove the edge, or say it in the node note');
    for (const [groupEnd, other] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const group = diagram.groups.find((candidate) => candidate.id === groupEnd);
      if (group && (groupNodeIds(diagram, group).includes(other) || other === groupEnd)) {
        error('structure/edge-into-own-group', `Edge "${edge.id}" joins group "${group.id}" to a node inside it.`, 'connect the node to another node or group');
      }
    }
  }
  for (const node of diagram.nodes) {
    if (!diagram.layout.nodes[node.id]) error('layout/missing-position', `Node "${node.id}" has no position in layout.nodes.`, `add layout.nodes["${node.id}"] = { x, y, w, h }`);
  }
  for (const lane of diagram.lanes) {
    if (!diagram.layout.lanes?.[lane.id]) error('layout/missing-position', `Lane "${lane.id}" has no position in layout.lanes.`, `add layout.lanes["${lane.id}"] = { x, y, w, h }`);
  }
  const stale = [
    ...Object.keys(diagram.layout.nodes).filter((id) => !nodeIds.has(id)),
    ...Object.keys(diagram.layout.groups ?? {}).filter((id) => !groupIds.has(id)),
    ...Object.keys(diagram.layout.edges ?? {}).filter((id) => !diagram.edges.some((edge) => edge.id === id)),
    ...Object.keys(diagram.layout.lanes ?? {}).filter((id) => !diagram.lanes.some((lane) => lane.id === id)),
  ];
  for (const id of stale) {
    issues.push({ code: 'layout/stale-entry', severity: 'warning', message: `The layout places "${id}", which the diagram no longer has.`, fix: `remove "${id}" from layout` });
  }
  return issues;
}

export function checkScene(scene: Scene): DiagramIssue[] {
  const issues: DiagramIssue[] = [];
  const error = (code: string, message: string, fix?: string) => issues.push({ code, severity: 'error', message, fix });
  const canvas = { x: 0, y: 0, width: scene.width, height: scene.height };
  const { diagram } = scene;

  scene.nodes.forEach((node, index) => {
    if (!contains(canvas, node)) {
      error('layout/node-out-of-canvas', `Node "${node.id}" falls outside the ${scene.width}×${scene.height} canvas.`,
        `move it inside, or set layout.canvas to at least [${Math.ceil(Math.max(scene.width, node.x + node.width))}, ${Math.ceil(Math.max(scene.height, node.y + node.height))}]`);
    }
    for (const other of scene.nodes.slice(index + 1)) {
      if (rectsOverlap(node, other, 8)) {
        error('layout/node-overlap', `Nodes "${node.id}" and "${other.id}" are less than 8px apart.`, `move "${other.id}" or shrink one of them`);
      }
    }
    const labelWidth = textUnits(node.node.label) * 6.6;
    if (labelWidth > node.width + 8) {
      error('text/label-overflow', `The label of "${node.id}" needs ~${Math.round(labelWidth)}px but the node is ${node.width}px wide.`,
        `shorten the label or widen the node to ${Math.ceil(labelWidth - 8)}px`);
    }
    for (const [field, value, minimum] of [['sublabel', node.node.sublabel, 6], ['tag', node.node.tag, 6]] as const) {
      if (!value) continue;
      const needed = textUnits(value) * minimum * 0.6;
      if (needed > node.width - 8) {
        error(`text/${field}-overflow`, `The ${field} of "${node.id}" needs ~${Math.ceil(needed)}px at ${minimum}px, but the node gives ${node.width - 8}px.`,
          `shorten the ${field} or widen the node`);
      }
    }
  });

  scene.frames.forEach((frame, index) => {
    const members = new Set(groupNodeIds(diagram, frame.group));
    if (!contains(canvas, frame)) {
      error('layout/frame-out-of-canvas', `Group "${frame.group.id}" falls outside the canvas.`, 'move its members inward or enlarge layout.canvas');
    }
    for (const node of scene.nodes) {
      if (!members.has(node.id) && rectsOverlap(frame, node)) {
        error('layout/frame-swallows-node', `Group "${frame.group.id}" covers node "${node.id}", which is not one of its members.`,
          `move "${node.id}" out of the frame, or add it to the group`);
      }
      if (rectsOverlap(frame.title, node)) {
        error('layout/frame-title-overlap', `The title of group "${frame.group.id}" overlaps node "${node.id}".`, 'move the node, or shorten the title');
      }
    }
    for (const other of scene.frames.slice(index + 1)) {
      if (rectsOverlap(frame.title, other.title)) {
        error('layout/frame-title-overlap', `The titles of groups "${frame.group.id}" and "${other.group.id}" overlap.`, 'shorten a title or move the members apart');
      }
      if (rectsOverlap(frame, other) && !contains(frame, other) && !contains(other, frame)) {
        error('layout/frames-cross', `Groups "${frame.group.id}" and "${other.group.id}" partly overlap.`, 'make one contain the other, or move them apart');
      }
    }
  });

  const labelled = scene.edges.filter((edge) => edge.label);
  labelled.forEach((edge, index) => {
    const label = edge.label!;
    const name = `The label of edge "${edge.edge.id}"`;
    if (!contains(canvas, label)) error('label/out-of-canvas', `${name} falls outside the canvas.`, 'move it with layout.edges labelDx/labelDy/labelAt');
    for (const node of scene.nodes) {
      if (rectsOverlap(label, node, -2)) error('label/collision', `${name} covers node "${node.id}".`, 'move the nodes apart, or place it with labelDx/labelDy/labelAt');
    }
    for (const frame of scene.frames) {
      if (rectsOverlap(label, frame.title)) error('label/collision', `${name} covers the title of group "${frame.group.id}".`, 'place it with labelDx/labelDy/labelAt');
    }
    for (const other of labelled.slice(index + 1)) {
      if (rectsOverlap(label, other.label!)) error('label/collision', `${name} overlaps the label of edge "${other.edge.id}".`, 'place one with labelDx/labelDy/labelAt');
    }
  });

  if (scene.legendUnfit) {
    issues.push({ code: 'legend/unfit', severity: 'warning', message: 'The legend does not fit below the diagram, so it is hidden.', fix: 'leave room at the bottom of the canvas, or set "legend": false' });
  }
  return issues;
}

export interface DiagramReport {
  diagram: Diagram | null;
  scene: Scene | null;
  issues: DiagramIssue[];
}

// Parses, checks and lays out a diagram file's content. The scene is only
// built when the structure is sound.
export function validateDiagram(value: unknown): DiagramReport {
  let diagram: Diagram;
  try {
    diagram = diagramSchema.parse(value);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    return {
      diagram: null,
      scene: null,
      issues: error.issues.map((issue) => ({
        code: 'schema/invalid',
        severity: 'error' as const,
        message: `${issue.path.join('.') || 'the file'}: ${issue.message}`,
      })),
    };
  }
  const issues = checkStructure(diagram);
  if (issues.some((issue) => issue.severity === 'error')) return { diagram, scene: null, issues };
  const scene = buildScene(diagram);
  return { diagram, scene, issues: [...issues, ...checkScene(scene)] };
}
