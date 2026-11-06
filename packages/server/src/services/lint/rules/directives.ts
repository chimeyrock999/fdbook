import type { Paragraph, Root } from 'mdast';
import type { ContainerDirective } from 'mdast-util-directive';
import { visit } from 'unist-util-visit';
import { CONTAINER_DIRECTIVES, LEAF_DIRECTIVES, TEXT_DIRECTIVES } from '@fdbook/mdx/notes-syntax.ts';
import { headOf, type Report } from '#services/lint/types.ts';

const containers = new Set<string>(CONTAINER_DIRECTIVES);
const leaves = new Set<string>(LEAF_DIRECTIVES);
const texts = new Set<string>(TEXT_DIRECTIVES);

// A line that is only a fence, maybe behind a blockquote marker or indent.
const FENCE_LINE = /^[\s>]*(:{3,})\s*$/;

function fenceLength(node: ContainerDirective, source: string) {
  const start = node.position?.start.offset ?? 0;
  return /^:*/.exec(source.slice(start))?.[0].length ?? 0;
}

// Same test as the site's directive plugin (getClosingFence): the last line
// must be a fence at least as long as the opening one. An unclosed container
// runs to the end of its parent instead.
function isClosed(node: ContainerDirective, source: string) {
  const lines = source.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0).split(/\r?\n/);
  const closing = lines.length > 1 ? FENCE_LINE.exec(lines.at(-1) ?? '')?.[1] : undefined;
  return closing !== undefined && closing.length >= fenceLength(node, source);
}

function hasLabel(node: ContainerDirective) {
  return node.children.some((child) => child.type === 'paragraph' && child.data?.directiveLabel === true);
}

// Fence lines a container did not take, left in a paragraph as text.
function strayFences(node: Paragraph, source: string, report: Report) {
  const start = node.position?.start;
  const end = node.position?.end;
  if (start?.offset === undefined || end?.offset === undefined) return;
  let offset = start.offset;
  for (const [index, line] of source.slice(start.offset, end.offset).split('\n').entries()) {
    const text = line.replace(/\r$/, '');
    const fence = FENCE_LINE.exec(text)?.[1];
    if (fence !== undefined) {
      const at = text.indexOf(fence);
      const point = { line: start.line + index, column: (index === 0 ? start.column : 1) + at, offset: offset + at };
      report({
        rule: 'directive-nesting',
        severity: 'error',
        message: 'This closing fence has no container to close. A container nested with as many colons as its parent closes them both at the first fence; give the outer one more colons (`::::`).',
        start: point,
        end: { ...point, column: point.column + fence.length, offset: point.offset + fence.length },
      });
    }
    offset += line.length + 1;
  }
}

// Directive names, required parts, closing fences and nesting. The site
// writes a directive it does not know back as text, so a typo shows up on
// the page as `:::exmaple` instead of failing the build.
export function checkDirectives(tree: Root, source: string, report: Report) {
  visit(tree, (node, _index, parent) => {
    if (node.type === 'paragraph') {
      strayFences(node, source, report);
      return;
    }
    if (node.type === 'leafDirective' && !leaves.has(node.name)) {
      report({
        rule: 'directive-unknown',
        severity: 'error',
        message: `Unknown directive \`::${node.name}\`. The site shows it as plain text.`,
        ...headOf(node, source),
      });
      return;
    }
    if (node.type === 'textDirective' && !texts.has(node.name)) {
      const start = node.position?.start.offset ?? 0;
      const written = source.slice(start, node.position?.end.offset ?? start);
      // A bare `:word` is how the site reads `a:b` or `note:this`; only a
      // label or attributes say a directive was meant.
      if (written.length > node.name.length + 1) {
        report({
          rule: 'directive-unknown',
          severity: 'error',
          message: `Unknown directive \`:${node.name}\`. The site shows it as plain text.`,
          ...headOf(node, source),
        });
      }
      return;
    }
    if (node.type !== 'containerDirective') return;
    const head = headOf(node, source);
    const fence = ':'.repeat(fenceLength(node, source));
    if (!containers.has(node.name)) {
      report({ rule: 'directive-unknown', severity: 'error', message: `Unknown directive \`${fence}${node.name}\`. The site shows it as plain text.`, ...head });
    } else if (node.name === 'tab' && !node.attributes?.value && !hasLabel(node)) {
      report({
        rule: 'directive-unknown',
        severity: 'error',
        message: '`:::tab` needs a `value` or a `[label]`; without one the site shows it as plain text.',
        ...head,
      });
    }
    // The parent's fence closes a child with as many colons; that, not a
    // missing fence, is what to fix.
    if (parent?.type === 'containerDirective' && fenceLength(node, source) >= fenceLength(parent, source)) {
      const outer = ':'.repeat(fenceLength(parent, source));
      report({
        rule: 'directive-nesting',
        severity: 'error',
        message: `\`${fence}${node.name}\` sits inside \`${outer}${parent.name}\` with as many colons, so its closing fence closes both. Give the outer one more colons (\`${outer}:${parent.name}\`).`,
        ...head,
      });
    } else if (!isClosed(node, source)) {
      report({
        rule: 'directive-unclosed',
        severity: 'error',
        message: `\`${fence}${node.name}\` is never closed, so it takes in everything after it. Close it with \`${fence}\`.`,
        ...head,
      });
    }
  });
}
