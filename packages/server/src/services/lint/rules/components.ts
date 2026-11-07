import type { Nodes, Root } from 'mdast';
import type { MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx-jsx';
import { visit } from 'unist-util-visit';
import { DIAGRAM_SUFFIX, DIAGRAMS_DIR, publicAsset } from '@fdbook/shared/asset-types.ts';
import { headOf, type LintContext, type Report } from '#services/lint/types.ts';

// fumadocs-ui's Callout types (components/callout.tsx); `warn` and `tip`
// are its aliases of `warning` and `info`.
const CALLOUT_TYPES = ['info', 'warning', 'error', 'success', 'idea'];
const calloutTypes = new Set([...CALLOUT_TYPES, 'warn', 'tip']);

type Jsx = MdxJsxFlowElement | MdxJsxTextElement;

// A string attribute, `null` when the attribute is there but not a plain
// string (`{expression}`, a bare boolean), `undefined` when it is missing.
// Rules only judge plain strings.
function attribute(node: Jsx, name: string): string | null | undefined {
  const found = node.attributes.find((item) => item.type === 'mdxJsxAttribute' && item.name === name);
  if (!found) return undefined;
  return typeof found.value === 'string' ? found.value : null;
}

function isJsx(node: Nodes, names: string[]): node is Jsx {
  return (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && names.includes(node.name ?? '');
}

// A `/…` image is a URL into public/: one with no file there shows broken.
function checkImage(node: Nodes, source: string, context: LintContext, report: Report, src: string) {
  const asset = publicAsset(src);
  if (asset !== null && context.assetExists(asset)) return;
  report({
    rule: 'asset-missing',
    severity: 'error',
    message: `\`${src}\` is not in \`public/\`, so the image does not show.`,
    ...headOf(node, source),
  });
}

function decodeUrlPath(url: string) {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

// components/mdx/diagram.tsx reads `<diagrams>/<src>.diagram.json`
// (packages/diagram/src/node/read-diagram.ts), so `src` is a path there, not a public URL, and it
// draws only a diagram that lays out.
function checkDiagram(node: Nodes, source: string, context: LintContext, report: Report, src: string | null | undefined) {
  if (src === null) return;
  if (src === undefined) {
    report({ rule: 'asset-missing', severity: 'error', message: '<Diagram> has no `src`, so the site shows a placeholder.', ...headOf(node, source) });
    return;
  }
  const problem = context.diagramProblem(src);
  if (problem === null) return;
  const file = `${DIAGRAMS_DIR}/${src.trim().replace(/^\/+/, '').replace(/\.diagram\.json$/, '')}${DIAGRAM_SUFFIX}`;
  if (problem === 'missing') {
    report({ rule: 'asset-missing', severity: 'error', message: `\`${file}\` does not exist, so the site shows a placeholder.`, ...headOf(node, source) });
    return;
  }
  report({
    rule: 'diagram-invalid',
    severity: problem.severity,
    message: problem.severity === 'error'
      ? `\`${file}\` ${problem.message}, so the site shows a placeholder.`
      : `\`${file}\` draws, but ${problem.message}`,
    ...headOf(node, source),
  });
}

function checkEmbeds(node: Nodes, source: string, context: LintContext, report: Report) {
  if (isJsx(node, ['Diagram'])) {
    checkDiagram(node, source, context, report, attribute(node, 'src'));
    return;
  }
  // Relative images are imported by the MDX build; only /… reads public/,
  // as a URL the browser asks for, so percent escapes are decoded.
  if (node.type === 'image' && node.url.startsWith('/') && !node.url.startsWith('//')) {
    checkImage(node, source, context, report, decodeUrlPath(node.url));
  }
}

function checkCallout(node: Nodes, source: string, report: Report) {
  if (!isJsx(node, ['Callout'])) return;
  const type = attribute(node, 'type');
  if (typeof type === 'string' && !calloutTypes.has(type)) {
    report({
      rule: 'callout-type',
      severity: 'error',
      message: `Callout type \`${type}\` is not one fumadocs knows, so it renders with no icon and a muted color. Use one of: ${CALLOUT_TYPES.join(', ')}.`,
      ...headOf(node, source),
    });
  }
  // fumadocs spreads `style` into the CSS it sets; a string there
  // (`style="warning"`) is no CSS and picks no type.
  if (typeof attribute(node, 'style') === 'string') {
    report({
      rule: 'callout-style',
      severity: 'error',
      message: 'Callout `style` takes CSS (`style={{…}}`), not a string, so the site ignores it. To pick the look, use `type`.',
      ...headOf(node, source),
    });
  }
}

// Components and their attributes: callout types, and files under public/
// or diagrams/ that the page reads.
export function checkComponents(tree: Root, source: string, context: LintContext, report: Report) {
  visit(tree, (node) => {
    checkCallout(node, source, report);
    checkEmbeds(node, source, context, report);
  });
}
