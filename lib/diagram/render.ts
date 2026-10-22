// Draws a scene as SVG markup in Archify's visual grammar: rounded nodes with
// a kind sigil, nested frames with a title pill, rounded orthogonal routes
// with masked labels and a halo where they cross, and the kind legend. The
// grammar is Archify's (MIT, renderers/architecture/render-architecture.mjs),
// and the icon paths and arrow markers are its renderers/shared/utils.mjs;
// its licence is in LICENSE.archify next to this file.
// Colours come from CSS classes (styles/diagram.css), so the page theme
// restyles the drawing; the markup itself holds no colour. Text too small
// to read at the note's width (node tags, a label's second line) is marked
// `data-detail="fine"` and shows once the diagram is expanded.

import type { Scene, SceneEdge, SceneFrame, SceneLane, SceneNode } from './scene.ts';
import { LEGEND_SWATCH_OFFSET } from './legend.ts';
import type { EdgeVariant } from './schema.ts';

// `tone-<name>` sets the --tone-* variables the drawing classes read
// (styles/diagram.css), so one rule colours a node, frame or swatch of any tone.
const toneClass = (tone: string) => `tone-${tone}`;

const esc = (value: string | number) => String(value).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
// Coordinates come out of float arithmetic; three decimals is below a hairline.
const num = (value: number) => String(Math.round(value * 1000) / 1000);

const SIGIL_SIZE = 11;
const ICON_SHAPE: Record<string, string> = {
  calendar: '<rect x="2" y="3.5" width="12" height="10.5" rx="2"/><path d="M5 2v3M11 2v3M2 7h12M5 10h2M9 10h2"/>',
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/>',
  person: '<circle cx="8" cy="4.5" r="2.5"/><path d="M3 14v-2a5 5 0 0 1 10 0v2"/>',
  briefcase: '<rect x="2" y="5" width="12" height="9" rx="2"/><path d="M5 5V2h6v3M2 9h12M7 9v2h2V9"/>',
  flag: '<path d="M3 14V2h10l-2 3 2 3H3"/>',
  moon: '<path d="M13.5 10A6 6 0 0 1 6 2.5 6 6 0 1 0 13.5 10Z"/>',
  window: '<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M2 6.5h12"/><circle cx="4.1" cy="4.8" r=".7" class="sigil-fill"/><circle cx="6.3" cy="4.8" r=".7" class="sigil-fill"/>',
  code: '<path d="M6 3 3 8l3 5M10 3l3 5-3 5"/>',
  cylinder: '<ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/>',
  cloud: '<path d="M4.3 12.5h7.3a2.4 2.4 0 0 0 .2-4.8 4 4 0 0 0-7.5-1.3A3.1 3.1 0 0 0 4.3 12.5Z"/>',
  shield: '<path d="M8 2.2 13 4v3.5c0 3.1-1.8 5.4-5 6.5-3.2-1.1-5-3.4-5-6.5V4Z"/><path d="m5.8 8 1.5 1.5 3-3"/>',
  queue: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/><circle cx="5" cy="4.5" r="1" class="sigil-fill"/><circle cx="10.5" cy="8" r="1" class="sigil-fill"/><circle cx="7" cy="11.5" r="1" class="sigil-fill"/>',
  external: '<rect x="2.5" y="5" width="8.5" height="8" rx="1.5"/><path d="M8 2.5h5.5V8M13.5 2.5 7.5 8.5"/>',
  dot: '<rect x="3" y="3" width="10" height="10" rx="2"/><circle cx="8" cy="8" r="1.2" class="sigil-fill"/>',
};

const MARKER_VARIANTS: EdgeVariant[] = ['default', 'emphasis', 'alert', 'dashed'];
const markerId = (prefix: string, variant: EdgeVariant, start = false) => `${prefix}-arrow-${variant}${start ? '-start' : ''}`;

function renderDefinitions(prefix: string) {
  const markers = MARKER_VARIANTS.flatMap((variant) => [
    `<marker id="${markerId(prefix, variant)}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" class="m-${variant}"/></marker>`,
    `<marker id="${markerId(prefix, variant, true)}" markerWidth="10" markerHeight="7" refX="1" refY="3.5" orient="auto"><polygon points="10 0, 0 3.5, 10 7" class="m-${variant}"/></marker>`,
  ]);
  return `<defs>${markers.join('')}</defs>`;
}

function renderLane({ x, y, width, height, radius, header, lane }: SceneLane) {
  return `<g data-lane-id="${esc(lane.id)}"><rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" rx="${radius}" class="c-lane" stroke-width="1"/>`
    + `<text x="${num(header.x)}" y="${num(header.y)}" class="t-dim" font-size="${header.fontSize}" font-weight="600" text-anchor="middle">${esc(header.text)}</text></g>`;
}

const frameClass = (frame: SceneFrame) => `${toneClass(frame.group.tone)}${frame.group.dashed ? ' frame-dashed' : ''}`;

function renderFrame(frame: SceneFrame) {
  return `<rect data-graph-role="structural-frame" data-group-id="${esc(frame.group.id)}" x="${num(frame.x)}" y="${num(frame.y)}" width="${num(frame.width)}" height="${num(frame.height)}" rx="${frame.radius}" class="c-frame ${frameClass(frame)}" stroke-width="1"/>`;
}

function renderFrameTitle(frame: SceneFrame) {
  const { title } = frame;
  return `<g data-graph-role="structural-frame-label" data-group-id="${esc(frame.group.id)}" class="${frameClass(frame)}">`
    + `<rect data-graph-role="structural-frame-label-mask" x="${num(title.x)}" y="${num(title.y)}" width="${num(title.width)}" height="${num(title.height)}" rx="3" class="c-mask"/>`
    + `<text x="${num(title.x + 4)}" y="${num(title.y + title.baselineOffset)}" class="t-tone" font-size="${num(title.fontSize)}" font-weight="600">${esc(frame.group.label)}</text></g>`;
}

const edgeAttrs = ({ edge }: SceneEdge) => `data-edge-id="${esc(edge.id)}" data-edge-from="${esc(edge.from)}" data-edge-to="${esc(edge.to)}"`;

function renderEdgePath(prefix: string, scene: SceneEdge) {
  const { edge, d, strokeWidth } = scene;
  const markers = `marker-end="url(#${markerId(prefix, edge.variant)})"${edge.bidirectional ? ` marker-start="url(#${markerId(prefix, edge.variant, true)})"` : ''}`;
  const path = `<path ${edgeAttrs(scene)} d="${d}" class="a-${edge.variant}" stroke-width="${strokeWidth}" ${markers}/>`;
  if (!scene.automatic) return `<g data-edge-group="">${path}</g>`;
  // The underlay draws the canvas colour under the route: where a later
  // route crosses it, the crossing shows as a small gap.
  const underlay = `<path data-graph-role="crossover-underlay" d="${d}" fill="none" stroke="var(--mask)" stroke-width="${strokeWidth + 4}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`;
  return `<g data-edge-group="" data-graph-role="automatic-crossover">${underlay}${path}</g>`;
}

const LABEL_CLASS: Record<EdgeVariant, string> = {
  default: 't-edge-default',
  emphasis: 't-edge-emphasis',
  alert: 't-edge-alert',
  dashed: 't-edge-dashed',
};

function renderEdgeLabel(scene: SceneEdge) {
  const { edge, label } = scene;
  if (!label || !edge.label) return '';
  const detail = edge.detail
    ? `<text data-detail="fine" x="${num(label.lx)}" y="${num(label.ly + 10)}" class="t-dim" font-size="7" text-anchor="middle">${esc(edge.detail)}</text>`
    : '';
  return `<g data-edge-label="" ${edgeAttrs(scene)}><rect x="${num(label.x)}" y="${num(label.y)}" width="${num(label.width)}" height="${num(label.height)}" rx="3" class="c-mask"/>`
    + `<text x="${num(label.lx)}" y="${num(label.ly)}" class="${LABEL_CLASS[edge.variant]}" font-size="8" text-anchor="middle">${esc(edge.label)}</text>${detail}</g>`;
}

function renderIcon({ kind, x, y }: SceneNode) {
  const icon = kind.icon ?? 'dot';
  if (icon === 'none') return '';
  return `<g aria-hidden="true" class="semantic-sigil" transform="translate(${num(x + 6)} ${num(y + 6)}) scale(${SIGIL_SIZE / 16})">${ICON_SHAPE[icon]}</g>`;
}

function renderNode(scene: SceneNode) {
  const { node, x, y, width, height, cx } = scene;
  const parts = [node.label, node.sublabel, scene.context.at(-1), node.tag].filter(Boolean);
  const aria = [node.label, node.sublabel, scene.context.at(-1)].filter(Boolean).join(', ');
  const labelY = node.sublabel ? y + height / 2 - 2 : y + height / 2 + 4;
  const sub = node.sublabel
    ? `<text x="${num(cx)}" y="${num(y + height / 2 + 14)}" class="t-muted" font-size="${scene.sublabelFont}" text-anchor="middle">${esc(node.sublabel)}</text>`
    : '';
  const tag = node.tag
    ? `<text data-detail="fine" x="${num(cx)}" y="${num(y + height - 8)}" class="t-tone" font-size="${scene.tagFont}" text-anchor="middle">${esc(node.tag)}</text>`
    : '';
  const box = `x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" rx="8"`;
  return `<g data-node-id="${esc(node.id)}" data-node-kind="${esc(node.kind)}" class="${toneClass(scene.kind.tone)}" tabindex="0" role="button" aria-pressed="false" aria-label="${esc(aria)}">`
    + `<title>${esc(parts.join(' · '))}</title>`
    + `<rect ${box} class="c-mask"/><rect ${box} class="c-node" stroke-width="1.5"/>${renderIcon(scene)}`
    + `<text x="${num(cx)}" y="${num(labelY)}" class="t-primary" font-size="${scene.labelFont}" font-weight="600" text-anchor="middle">${esc(node.label)}</text>${sub}${tag}</g>`;
}

function renderLegend({ legend }: Scene) {
  if (!legend) return '';
  const entries = legend.entries.map((entry) => `<g data-legend-kind="${esc(entry.kind)}" class="${toneClass(entry.tone)}">`
    + `<rect x="${entry.x}" y="${entry.baseline - 9}" width="16" height="10" rx="2.5" class="c-node" stroke-width="1"/>`
    + `<text x="${entry.x + LEGEND_SWATCH_OFFSET}" y="${entry.baseline}" class="t-muted" font-size="${legend.fontSize}" font-weight="500">${esc(entry.label)} <tspan class="t-dim">${entry.count}</tspan></text></g>`);
  return `<g data-legend=""><text x="${legend.x}" y="${legend.titleY}" class="t-primary" font-size="12" font-weight="650">Legend</text>${entries.join('')}</g>`;
}

// `idPrefix` keeps marker ids distinct when several diagrams share a page;
// `title` names the drawing, by default with the diagram's own title.
export function renderDiagramSvg(scene: Scene, idPrefix: string, title = scene.diagram.title) {
  const prefix = idPrefix.replace(/[^\w-]/g, '-');
  const titleId = `${prefix}-title`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" class="dg-svg" data-diagram="" role="img" aria-labelledby="${titleId}">`
    + `<title id="${titleId}">${esc(title)}</title>`
    + renderDefinitions(prefix)
    + scene.lanes.map(renderLane).join('')
    + scene.frames.map(renderFrame).join('')
    + scene.edges.map((edge) => renderEdgePath(prefix, edge)).join('')
    + scene.nodes.map(renderNode).join('')
    + scene.edges.map(renderEdgeLabel).join('')
    + scene.frames.map(renderFrameTitle).join('')
    + renderLegend(scene)
    + '</svg>';
}
