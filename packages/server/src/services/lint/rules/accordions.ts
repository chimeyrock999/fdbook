import type { Nodes, Root } from 'mdast';
import type { ContainerDirective } from 'mdast-util-directive';
import type { MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx-jsx';
import { visit } from 'unist-util-visit';
import { accordionDirectiveTitle } from '@fdbook/mdx/remark-notes-directives.ts';
import { headOf, type Report } from '#services/lint/types.ts';

type Item = ContainerDirective | MdxJsxFlowElement | MdxJsxTextElement;

// A string attribute, `null` when it is there but not a plain string
// (`{expression}`), `undefined` when it is missing.
function attribute(node: Item, name: string): string | null | undefined {
  if (node.type === 'containerDirective') {
    const value = node.attributes?.[name];
    return value === undefined ? undefined : (value ?? null);
  }
  const found = node.attributes.find((each) => each.type === 'mdxJsxAttribute' && each.name === name);
  if (!found) return undefined;
  return typeof found.value === 'string' ? found.value : null;
}

// The group's items: its `:::accordion` directives and the `<Accordion>`
// written straight in it, which the site keeps as items of the group too. A
// line holding only JSX parses as a paragraph around it; MDX unwraps that.
function itemsOf(group: ContainerDirective): Item[] {
  return group.children.flatMap((child): Nodes[] => (child.type === 'paragraph' ? child.children : [child])).filter((node): node is Item =>
    (node.type === 'containerDirective' && node.name === 'accordion') ||
    ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name === 'Accordion'));
}

// The item's value as components/accordion.tsx gives it: `value`, else its
// title. `null` when one of them is an expression the lint cannot read.
function valueOf(item: Item): string | null {
  const value = attribute(item, 'value');
  if (value !== undefined) return value;
  if (item.type === 'containerDirective') return accordionDirectiveTitle(item);
  return attribute(item, 'title') ?? null;
}

// `::::accordions` is the root of its items (packages/mdx/src/remark-notes-directives.ts),
// so the group's `type` and `defaultValue` decide how they open: a `type` on
// a `:::accordion` does nothing, two items with one value open and close
// together, and a `defaultValue` no item has opens nothing.
export function checkAccordions(tree: Root, source: string, report: Report) {
  visit(tree, 'containerDirective', (group) => {
    if (group.name !== 'accordions') return;
    const values = new Set<string>();
    let unread = false;
    for (const item of itemsOf(group)) {
      if (item.type === 'containerDirective' && item.attributes?.type != null) {
        report({
          rule: 'accordion-group',
          severity: 'warning',
          message: 'An accordion inside `::::accordions` takes the group\'s `type`, so its own `type` does nothing. Set `type` on `::::accordions`.',
          ...headOf(item, source),
        });
      }
      const value = valueOf(item);
      if (value === null) {
        unread = true;
        continue;
      }
      if (values.has(value)) {
        report({
          rule: 'accordion-group',
          severity: 'warning',
          message: `Another accordion in this group already has the value \`${value}\`, so the two open and close together. Give one a \`value\` or another title.`,
          ...headOf(item, source),
        });
      }
      values.add(value);
    }
    const opened = attribute(group, 'defaultValue');
    if (typeof opened === 'string' && !unread && !values.has(opened)) {
      const multiple = attribute(group, 'type') === 'multiple';
      report({
        rule: 'accordion-group',
        severity: 'warning',
        message: `No accordion in this group has the value \`${opened}\`, so \`defaultValue\` opens nothing. Use an item's \`value\` or title${multiple ? '; it names one item, also with `type="multiple"`' : ''}.`,
        ...headOf(group, source),
      });
    }
  });
}
