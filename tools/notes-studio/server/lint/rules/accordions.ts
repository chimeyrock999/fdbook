import type { PhrasingContent, Root } from 'mdast';
import type { ContainerDirective } from 'mdast-util-directive';
import { visit } from 'unist-util-visit';
import { headOf, type Report } from '../types.ts';

function text(children: PhrasingContent[]): string {
  return children.map((child) => ('value' in child ? child.value : 'children' in child ? text(child.children) : '')).join('');
}

function stringAttribute(node: ContainerDirective, name: string) {
  const value = node.attributes?.[name];
  return typeof value === 'string' ? value : undefined;
}

// The item's value as the site gives it (components/accordion.tsx): `value`,
// else its title, from `title` or the `[label]`, else "Accordion" as
// lib/remark-notes-directives.ts writes it.
function valueOf(item: ContainerDirective) {
  const label = item.children[0]?.type === 'paragraph' && item.children[0].data?.directiveLabel ? text(item.children[0].children) : undefined;
  return stringAttribute(item, 'value') ?? stringAttribute(item, 'title') ?? label ?? 'Accordion';
}

// `::::accordions` is the root of its `:::accordion` items
// (lib/remark-notes-directives.ts), so the group's `type` and `defaultValue`
// decide how they open: a `type` on an item does nothing, two items with one
// value open and close together, and a `defaultValue` no item has opens
// nothing.
export function checkAccordions(tree: Root, source: string, report: Report) {
  visit(tree, 'containerDirective', (group) => {
    if (group.name !== 'accordions') return;
    const items = group.children.filter((child): child is ContainerDirective => child.type === 'containerDirective' && child.name === 'accordion');
    const values = new Set<string>();
    for (const item of items) {
      if (item.attributes?.type != null) {
        report({
          rule: 'accordion-group',
          severity: 'warning',
          message: 'An accordion inside `::::accordions` takes the group\'s `type`, so its own `type` does nothing. Set `type` on `::::accordions`.',
          ...headOf(item, source),
        });
      }
      const value = valueOf(item);
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
    const opened = stringAttribute(group, 'defaultValue');
    if (opened !== undefined && !values.has(opened)) {
      report({
        rule: 'accordion-group',
        severity: 'warning',
        message: `No accordion in this group has the value \`${opened}\`, so \`defaultValue\` opens nothing. Use an item's \`value\` or title.`,
        ...headOf(group, source),
      });
    }
  });
}
