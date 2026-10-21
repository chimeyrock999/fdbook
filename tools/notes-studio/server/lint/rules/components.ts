import type { Nodes, Root } from 'mdast';
import type { ContainerDirective, LeafDirective, TextDirective } from 'mdast-util-directive';
import type { MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx-jsx';
import { visit } from 'unist-util-visit';
import { ACCORDION_KINDS, CALLOUT_TYPES } from '../../../../../lib/notes-syntax.ts';
import { headOf, type LintContext, type Report } from '../types.ts';

const calloutTypes = new Set<string>(CALLOUT_TYPES);
const accordionKinds = new Set<string>(ACCORDION_KINDS);

type Jsx = MdxJsxFlowElement | MdxJsxTextElement;
type Directive = ContainerDirective | LeafDirective | TextDirective;

// A string attribute, `null` when the attribute is there but not a plain
// string (`{expression}`, a bare boolean), `undefined` when it is missing.
// Rules only judge plain strings.
function attribute(node: Jsx | Directive, name: string): string | null | undefined {
  if (node.type === 'containerDirective' || node.type === 'leafDirective' || node.type === 'textDirective') {
    return node.attributes?.[name] ?? undefined;
  }
  const found = node.attributes.find((item) => item.type === 'mdxJsxAttribute' && item.name === name);
  if (!found) return undefined;
  return typeof found.value === 'string' ? found.value : null;
}

function firstAttribute(node: Jsx | Directive, names: string[]) {
  for (const name of names) {
    const value = attribute(node, name);
    if (value !== undefined) return value;
  }
  return undefined;
}

function isJsx(node: Nodes, names: string[]): node is Jsx {
  return (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && names.includes(node.name ?? '');
}

// The file under public/ that the site would read for `src`
// (lib/read-public-asset.ts), or null when it is outside public/.
function publicAsset(src: string) {
  const segments: string[] = [];
  for (const segment of (src.split(/[?#]/)[0] ?? '').trim().split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.length > 0 ? segments.join('/') : null;
}

// The site reads `src` from public/ only (lib/read-public-asset.ts): a URL
// such as https://… shows the placeholder too.
function checkAsset(node: Nodes, source: string, context: LintContext, report: Report, src: string | null | undefined, label: string) {
  if (src === null) return;
  if (src === undefined) {
    report({ rule: 'asset-missing', severity: 'error', message: `${label} has no \`src\`, so the site shows a placeholder.`, ...headOf(node, source) });
    return;
  }
  const asset = /^[a-z][a-z0-9+.-]*:/i.test(src) ? null : publicAsset(src);
  if (asset !== null && context.assetExists(asset)) return;
  report({
    rule: 'asset-missing',
    severity: 'error',
    message: `\`${src}\` is not in \`public/\`, so the site shows a placeholder.`,
    ...headOf(node, source),
  });
}

function checkEmbeds(node: Nodes, source: string, context: LintContext, report: Report) {
  if (isJsx(node, ['HtmlEmbed', 'SvgDiagram'])) {
    // Inline markup (`html` or `svg`) needs no file.
    const inline = node.name === 'HtmlEmbed' ? 'html' : 'svg';
    if (attribute(node, inline) === undefined) checkAsset(node, source, context, report, attribute(node, 'src'), `<${node.name ?? ''}>`);
    return;
  }
  if (node.type === 'leafDirective') {
    if (['html', 'svg', 'diagram'].includes(node.name)) {
      checkAsset(node, source, context, report, attribute(node, 'src'), `\`::${node.name}\``);
    }
    return;
  }
  // Relative images are imported by the MDX build; only /… reads public/.
  if (node.type === 'image' && node.url.startsWith('/') && !node.url.startsWith('//')) {
    checkAsset(node, source, context, report, node.url, 'The image');
  }
}

function checkKinds(node: Nodes, source: string, report: Report) {
  if (isJsx(node, ['Callout'])) {
    const type = attribute(node, 'type');
    if (typeof type === 'string' && !calloutTypes.has(type)) {
      report({
        rule: 'callout-type',
        severity: 'error',
        message: `Callout type \`${type}\` is not one the site knows, so it renders as \`info\`. Use one of: ${CALLOUT_TYPES.join(', ')}.`,
        ...headOf(node, source),
      });
    }
    return;
  }
  const accordion = isJsx(node, ['Accordion']) || (node.type === 'containerDirective' && node.name === 'accordion') ? node : null;
  if (!accordion) return;
  const kind = attribute(accordion, 'kind');
  if (typeof kind === 'string' && !accordionKinds.has(kind)) {
    report({
      rule: 'accordion-kind',
      severity: 'error',
      // components/accordion.tsx renders the kind's icon, which is undefined here.
      message: `Accordion kind \`${kind}\` is not one the site knows, so the page fails to render (the accordion has no icon for it). Use one of: ${ACCORDION_KINDS.join(', ')}.`,
      ...headOf(node, source),
    });
  }
}

// `anchor` markers name a section (its heading's anchor and graph node);
// keywords and tags may repeat an id to point back at one.
type Marker = {
  node: Nodes;
  name: string;
  anchor: boolean;
  id: string | null | undefined;
  displayName: string | null | undefined;
  label: boolean;
};

const SECTION_TAGS = ['GraphMeta', 'graph-meta', 'SectionTitle', 'GraphSection'];

// A section as lib/build-graph.ts decides it: its tag, or graphType /
// graphKind="section" on any marker.
function isSection(node: Jsx | TextDirective) {
  const kind = firstAttribute(node, ['graphType', 'graphKind']);
  if (kind === 'section') return true;
  if (kind === 'keyword') return false;
  return node.type === 'textDirective' ? node.name === 'graph-meta' : SECTION_TAGS.includes(node.name ?? '');
}

// Graph markers as lib/build-graph.ts reads them: GraphMeta (JSX or
// `:graph-meta`), and Keyword / Tag / SectionTitle / GraphSection (JSX or
// `:keyword` / `:tag`, where the label stands in for displayName).
function markerOf(node: Nodes): Marker | null {
  const names = ['displayName', 'displayname'];
  if (isJsx(node, [...SECTION_TAGS, 'Keyword', 'Tag'])) {
    return {
      node,
      name: `<${node.name ?? ''}>`,
      // GraphMeta names its heading's anchor whatever its kind.
      anchor: node.name === 'GraphMeta' || node.name === 'graph-meta' || isSection(node),
      id: attribute(node, 'id'),
      displayName: firstAttribute(node, names),
      label: false,
    };
  }
  if (node.type !== 'textDirective' || !['graph-meta', 'keyword', 'tag'].includes(node.name)) return null;
  return {
    node,
    name: `:${node.name}`,
    anchor: node.name === 'graph-meta' || isSection(node),
    id: attribute(node, 'id'),
    displayName: firstAttribute(node, names),
    label: node.children.length > 0,
  };
}

function checkMarker(marker: Marker, source: string, report: Report) {
  const range = headOf(marker.node, source);
  if (marker.id === undefined || marker.id === '') {
    report({ rule: 'graph-meta-incomplete', severity: 'error', message: `${marker.name} has no \`id\`, so it is not in the graph.`, ...range });
    return;
  }
  if (marker.displayName !== undefined || marker.label) return;
  const graphMeta = marker.name === '<GraphMeta>' || marker.name === '<graph-meta>' || marker.name === ':graph-meta';
  report(
    graphMeta
      ? { rule: 'graph-meta-incomplete', severity: 'warning', message: `${marker.name} has no \`displayName\`; the graph uses the heading text.`, ...range }
      : { rule: 'graph-meta-incomplete', severity: 'error', message: `${marker.name} has no \`displayName\`, so it is not in the graph.`, ...range },
  );
}

// Components and their attributes: callout types, accordion kinds, files
// under public/, and graph markers. The same id on two pages is how the
// graph links them, and a keyword may reuse a section's id to point at it, so
// only two sections with one id inside one page are an error.
export function checkComponents(tree: Root, source: string, context: LintContext, report: Report) {
  const seen = new Set<string>();
  visit(tree, (node) => {
    checkKinds(node, source, report);
    checkEmbeds(node, source, context, report);
    const marker = markerOf(node);
    if (!marker) return;
    checkMarker(marker, source, report);
    if (!marker.anchor || typeof marker.id !== 'string' || marker.id === '') return;
    if (seen.has(marker.id)) {
      report({
        rule: 'graph-id-duplicate',
        severity: 'error',
        message: `The graph id \`${marker.id}\` is already used in this note, so its anchor and graph node point to the first one.`,
        ...headOf(marker.node, source),
      });
    }
    seen.add(marker.id);
  });
}
