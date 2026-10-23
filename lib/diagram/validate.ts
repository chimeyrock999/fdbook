// Checks a diagram can be drawn and reads well, with a stable code and a fix
// for each problem: structure first (ids, members, ends, positions), then the
// drawn geometry (overlaps, frames, labels, text that cannot fit). The text
// and overlap limits are Archify's (render-architecture.mjs validation).
// `path` names where in the file to look (`nodes[2].kind`,
// `layout.nodes.plan`), so an agent can fix the right line.

import { ZodError } from 'zod';
import { minimumReadableSourceTextPx, rectsOverlap, textUnits, type Rect } from './geometry.ts';
import { buildScene, groupNodeIds, type Scene } from './scene.ts';
import { diagramSchema, type Diagram } from './schema.ts';
import { checkLifecycleScene, checkLifecycleStructure } from './validate-lifecycle.ts';
import { checkSequenceOnly, checkSequenceScene, checkSequenceStructure } from './validate-sequence.ts';

export interface DiagramIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  fix?: string;
  path?: string;
}

// The size render.ts draws an edge label at.
const EDGE_LABEL_FONT = 8;

const contains = (outer: Rect, inner: Rect) => outer.x <= inner.x + 1e-9 && outer.y <= inner.y + 1e-9
  && outer.x + outer.width + 1e-9 >= inner.x + inner.width && outer.y + outer.height + 1e-9 >= inner.y + inner.height;

export function checkStructure(diagram: Diagram): DiagramIssue[] {
  const issues: DiagramIssue[] = [];
  const error = (code: string, message: string, fix?: string, path?: string) => issues.push({ code, severity: 'error', message, fix, path });
  const seen = new Map<string, string>();
  for (const [kind, area, items] of [['kind', 'kinds', diagram.kinds], ['badge', 'badges', diagram.badges], ['node', 'nodes', diagram.nodes], ['group', 'groups', diagram.groups], ['edge', 'edges', diagram.edges], ['lane', 'lanes', diagram.lanes]] as const) {
    items.forEach(({ id }, index) => {
      if (seen.has(id)) error('structure/duplicate-id', `The id "${id}" names both a ${seen.get(id)} and a ${kind}.`, `rename one of them`, `${area}[${index}].id`);
      else seen.set(id, kind);
    });
  }
  const nodeIds = new Set(diagram.nodes.map((node) => node.id));
  const groupIds = new Set(diagram.groups.map((group) => group.id));
  const kindIds = new Set(diagram.kinds.map((kind) => kind.id));
  const badgeIds = new Set(diagram.badges.map((badge) => badge.id));
  diagram.nodes.forEach((node, index) => {
    if (!kindIds.has(node.kind)) {
      error('structure/unknown-kind', `Node "${node.id}" is of kind "${node.kind}", which the diagram does not list in kinds.`, `add { "id": "${node.kind}", "label": …, "tone": … } to kinds`, `nodes[${index}].kind`);
    }
    if (node.note?.badge && !badgeIds.has(node.note.badge)) {
      error('structure/unknown-badge', `The note of "${node.id}" has badge "${node.note.badge}", which the diagram does not list in badges.`, `add { "id": "${node.note.badge}", "label": …, "tone": … } to badges`, `nodes[${index}].note.badge`);
    }
  });
  diagram.kinds.forEach((kind, index) => {
    if (!diagram.nodes.some((node) => node.kind === kind.id)) {
      issues.push({ code: 'structure/unused-kind', severity: 'warning', message: `No node is of kind "${kind.id}".`, fix: `remove "${kind.id}" from kinds`, path: `kinds[${index}]` });
    }
  });
  diagram.groups.forEach((group, groupIndex) => {
    group.members.forEach((member, index) => {
      if (!nodeIds.has(member) && !groupIds.has(member)) {
        error('structure/unknown-member', `Group "${group.id}" lists "${member}", which is no node or group.`, `remove "${member}" from its members or add that node`, `groups[${groupIndex}].members[${index}]`);
      }
    });
    const reaches = (id: string, path: Set<string>): boolean => diagram.groups.find((other) => other.id === id)?.members
      .some((member) => member === group.id || (groupIds.has(member) && !path.has(member) && reaches(member, new Set([...path, member])))) ?? false;
    if (reaches(group.id, new Set([group.id]))) {
      error('structure/group-cycle', `Group "${group.id}" contains itself through its member groups.`, 'list the nodes instead of the outer group', `groups[${groupIndex}].members`);
    }
  });
  diagram.edges.forEach((edge, index) => {
    for (const end of ['from', 'to'] as const) {
      if (!nodeIds.has(edge[end]) && !groupIds.has(edge[end])) {
        error('structure/unknown-endpoint', `Edge "${edge.id}" ends at "${edge[end]}", which is no node or group.`, `point the edge at an existing node or group id`, `edges[${index}].${end}`);
      }
    }
    // A sequence says why itself; a lifecycle's state may transition to itself.
    if (edge.from === edge.to && diagram.type === 'architecture') error('structure/self-loop', `Edge "${edge.id}" starts and ends at "${edge.from}".`, 'remove the edge, or say it in the node note', `edges[${index}]`);
    for (const [groupEnd, other] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const group = diagram.groups.find((candidate) => candidate.id === groupEnd);
      if (group && (groupNodeIds(diagram, group).includes(other) || other === groupEnd)) {
        error('structure/edge-into-own-group', `Edge "${edge.id}" joins group "${group.id}" to a node inside it.`, 'connect the node to another node or group', `edges[${index}]`);
      }
    }
  });
  if (diagram.type === 'sequence') return [...issues, ...checkSequenceStructure(diagram)];
  if (diagram.type === 'lifecycle') return [...issues, ...checkLifecycleStructure(diagram)];
  issues.push(...checkSequenceOnly(diagram));
  if (diagram.mainPath.length) error('structure/lifecycle-only', 'A main path belongs to a lifecycle.', 'set "type": "lifecycle", or remove mainPath', 'mainPath');
  for (const node of diagram.nodes) {
    if (!diagram.layout.nodes[node.id]) error('layout/missing-position', `Node "${node.id}" has no position in layout.nodes.`, `run layout, or add layout.nodes["${node.id}"] = { x, y, w, h }`, `layout.nodes.${node.id}`);
  }
  for (const lane of diagram.lanes) {
    if (!diagram.layout.lanes?.[lane.id]) error('layout/missing-position', `Lane "${lane.id}" has no position in layout.lanes.`, `add layout.lanes["${lane.id}"] = { x, y, w, h }`, `layout.lanes.${lane.id}`);
  }
  const stale = [
    ...Object.keys(diagram.layout.nodes).filter((id) => !nodeIds.has(id)).map((id) => ['nodes', id]),
    ...Object.keys(diagram.layout.groups ?? {}).filter((id) => !groupIds.has(id)).map((id) => ['groups', id]),
    ...Object.keys(diagram.layout.edges ?? {}).filter((id) => !diagram.edges.some((edge) => edge.id === id)).map((id) => ['edges', id]),
    ...Object.keys(diagram.layout.lanes ?? {}).filter((id) => !diagram.lanes.some((lane) => lane.id === id)).map((id) => ['lanes', id]),
  ];
  for (const [area, id] of stale) {
    issues.push({ code: 'layout/stale-entry', severity: 'warning', message: `The layout places "${id}", which the diagram no longer has.`, fix: `remove "${id}" from layout`, path: `layout.${area}.${id}` });
  }
  return issues;
}

export function checkScene(scene: Scene): DiagramIssue[] {
  if (scene.sequence) return checkSequenceScene(scene);
  if (scene.lifecycle) return checkLifecycleScene(scene);
  const issues: DiagramIssue[] = [];
  const error = (code: string, message: string, fix?: string, path?: string) => issues.push({ code, severity: 'error', message, fix, path });
  const canvas = { x: 0, y: 0, width: scene.width, height: scene.height };
  const { diagram } = scene;
  const nodeIndex = new Map(diagram.nodes.map((node, index) => [node.id, index]));
  const groupIndex = new Map(diagram.groups.map((group, index) => [group.id, index]));
  const edgeIndex = new Map(diagram.edges.map((edge, index) => [edge.id, index]));
  // Text shown at the note's width must read at 6px or more on a desktop
  // screen: a canvas wider than the reading column is scaled down to fit it.
  const readable = minimumReadableSourceTextPx(scene.width);
  const tooSmall = (size: number) => size + 1e-6 < readable;
  const smallFix = `shorten the text, widen what holds it, or narrow the canvas: at ${scene.width}px wide, text needs ${Math.ceil(readable * 10) / 10}px or more`;

  scene.nodes.forEach((node, index) => {
    const at = `layout.nodes.${node.id}`;
    if (!contains(canvas, node)) {
      error('layout/node-out-of-canvas', `Node "${node.id}" falls outside the ${scene.width}×${scene.height} canvas.`,
        `move it inside, or set layout.canvas to at least [${Math.ceil(Math.max(scene.width, node.x + node.width))}, ${Math.ceil(Math.max(scene.height, node.y + node.height))}]`, at);
    }
    for (const other of scene.nodes.slice(index + 1)) {
      if (rectsOverlap(node, other, 8)) {
        error('layout/node-overlap', `Nodes "${node.id}" and "${other.id}" are less than 8px apart.`, `move "${other.id}" or shrink one of them`, `layout.nodes.${other.id}`);
      }
    }
    const field = `nodes[${nodeIndex.get(node.id)}]`;
    const labelWidth = textUnits(node.node.label) * 6.6;
    if (labelWidth > node.width + 8) {
      error('text/label-overflow', `The label of "${node.id}" needs ~${Math.round(labelWidth)}px but the node is ${node.width}px wide.`,
        `shorten the label or widen the node to ${Math.ceil(labelWidth - 8)}px`, `${field}.label`);
    }
    for (const [name, value, minimum] of [['sublabel', node.node.sublabel, 6], ['tag', node.node.tag, 6]] as const) {
      if (!value) continue;
      const needed = textUnits(value) * minimum * 0.6;
      if (needed > node.width - 8) {
        error(`text/${name}-overflow`, `The ${name} of "${node.id}" needs ~${Math.ceil(needed)}px at ${minimum}px, but the node gives ${node.width - 8}px.`,
          `shorten the ${name} or widen the node`, `${field}.${name}`);
      }
    }
    // The tag shows only in the expanded view, at full size.
    for (const [name, size] of [['label', node.labelFont], ['sublabel', node.node.sublabel ? node.sublabelFont : Infinity]] as const) {
      if (tooSmall(size)) {
        error('text/too-small-at-desktop', `The ${name} of "${node.id}" is drawn at ${size}px, under ${Math.ceil(readable * 10) / 10}px once the ${scene.width}px canvas fits the 930px reading column.`, smallFix, `${field}.${name}`);
      }
    }
  });

  scene.frames.forEach((frame, index) => {
    const members = new Set(groupNodeIds(diagram, frame.group));
    const field = `groups[${groupIndex.get(frame.group.id)}]`;
    if (!contains(canvas, frame)) {
      error('layout/frame-out-of-canvas', `Group "${frame.group.id}" falls outside the canvas.`, 'move its members inward or enlarge layout.canvas', field);
    }
    if (tooSmall(frame.title.fontSize)) {
      error('text/too-small-at-desktop', `The title of group "${frame.group.id}" is drawn at ${frame.title.fontSize}px, under ${Math.ceil(readable * 10) / 10}px at desktop width.`, smallFix, `${field}.label`);
    }
    for (const node of scene.nodes) {
      if (!members.has(node.id) && rectsOverlap(frame, node)) {
        error('layout/frame-swallows-node', `Group "${frame.group.id}" covers node "${node.id}", which is not one of its members.`,
          `move "${node.id}" out of the frame, or add it to the group`, `layout.nodes.${node.id}`);
      }
      if (rectsOverlap(frame.title, node)) {
        error('layout/frame-title-overlap', `The title of group "${frame.group.id}" overlaps node "${node.id}".`, 'move the node, or shorten the title', `layout.nodes.${node.id}`);
      }
    }
    for (const other of scene.frames.slice(index + 1)) {
      if (rectsOverlap(frame.title, other.title)) {
        error('layout/frame-title-overlap', `The titles of groups "${frame.group.id}" and "${other.group.id}" overlap.`, 'shorten a title or move the members apart', `groups[${groupIndex.get(other.group.id)}].label`);
      }
      if (rectsOverlap(frame, other) && !contains(frame, other) && !contains(other, frame)) {
        error('layout/frames-cross', `Groups "${frame.group.id}" and "${other.group.id}" partly overlap.`, 'make one contain the other, or move them apart', `groups[${groupIndex.get(other.group.id)}].members`);
      }
    }
  });

  const labelled = scene.edges.filter((edge) => edge.label);
  labelled.forEach((edge, index) => {
    const label = edge.label!;
    const name = `The label of edge "${edge.edge.id}"`;
    const at = `layout.edges.${edge.edge.id}`;
    if (!contains(canvas, label)) error('label/out-of-canvas', `${name} falls outside the canvas.`, 'move it with layout.edges labelDx/labelDy/labelAt', at);
    if (tooSmall(EDGE_LABEL_FONT)) {
      error('text/too-small-at-desktop', `${name} is drawn at ${EDGE_LABEL_FONT}px, under ${Math.ceil(readable * 10) / 10}px at desktop width.`, smallFix, `edges[${edgeIndex.get(edge.edge.id)}].label`);
    }
    for (const node of scene.nodes) {
      if (rectsOverlap(label, node, -2)) error('label/collision', `${name} covers node "${node.id}".`, 'move the nodes apart, or place it with labelDx/labelDy/labelAt', at);
    }
    for (const frame of scene.frames) {
      if (rectsOverlap(label, frame.title)) error('label/collision', `${name} covers the title of group "${frame.group.id}".`, 'place it with labelDx/labelDy/labelAt', at);
    }
    for (const other of labelled.slice(index + 1)) {
      if (rectsOverlap(label, other.label!)) error('label/collision', `${name} overlaps the label of edge "${other.edge.id}".`, 'place one with labelDx/labelDy/labelAt', at);
    }
  });

  if (scene.legendUnfit) {
    issues.push({ code: 'legend/unfit', severity: 'warning', message: 'The legend does not fit below the diagram, so it is hidden.', fix: 'leave room at the bottom of the canvas, or set "legend": false', path: 'legend' });
  }
  return issues;
}

export interface DiagramReport {
  diagram: Diagram | null;
  scene: Scene | null;
  issues: DiagramIssue[];
}

// The errors that stop a diagram from being laid out automatically: all but
// the node positions the layout is about to fill in. Lanes it does not place.
export function checkBeforeLayout(value: unknown): DiagramIssue[] {
  const parsed = parseIssues(value);
  if (!('diagram' in parsed)) return parsed.issues;
  return checkStructure(parsed.diagram).filter((issue) => issue.severity === 'error' && !(issue.code === 'layout/missing-position' && issue.path?.startsWith('layout.nodes.')));
}

// Schema errors only: the file's shape, before any id is looked up.
export function checkSchema(value: unknown): DiagramIssue[] {
  const parsed = parseIssues(value);
  return 'issues' in parsed ? parsed.issues : [];
}

function parseIssues(value: unknown): { diagram: Diagram } | { issues: DiagramIssue[] } {
  try {
    return { diagram: diagramSchema.parse(value) };
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    return {
      issues: error.issues.map((issue) => ({
        code: 'schema/invalid',
        severity: 'error' as const,
        message: `${issue.path.join('.') || 'the file'}: ${issue.message}`,
        path: issue.path.map((key) => (typeof key === 'number' ? `[${key}]` : `.${String(key)}`)).join('').replace(/^\./, '') || undefined,
      })),
    };
  }
}

// Errors a diagram still draws with, so the editor shows what to fix: a
// lifecycle's main path is laid out from the states it names once.
const DRAWS_ANYWAY = new Set([
  'lifecycle/main-path-gap', 'lifecycle/main-path-too-short', 'lifecycle/unknown-main-path-state',
  'lifecycle/repeated-main-path-state', 'lifecycle/two-way-transition', 'lifecycle/state-text-too-long',
]);

// Parses, checks and lays out a diagram file's content. The scene is only
// built when the structure is sound, but for the errors above.
export function validateDiagram(value: unknown): DiagramReport {
  const parsed = parseIssues(value);
  if (!('diagram' in parsed)) return { diagram: null, scene: null, issues: parsed.issues };
  const { diagram } = parsed;
  const issues = checkStructure(diagram);
  if (issues.some((issue) => issue.severity === 'error' && !DRAWS_ANYWAY.has(issue.code))) return { diagram, scene: null, issues };
  const scene = buildScene(diagram);
  return { diagram, scene, issues: [...issues, ...checkScene(scene)] };
}
