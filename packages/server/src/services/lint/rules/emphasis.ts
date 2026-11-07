import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';
import { pointOf, type Report } from '#services/lint/types.ts';

// The notes use `*` and `**`, the markers the editor writes: a paragraph with
// `_a_` or `__b__` gets them rewritten on its first edit in Visual. Only the
// node's first source character is read, so underscores that are not
// emphasis (snake_case, URLs, code) are never looked at.
export function checkEmphasis(tree: Root, source: string, report: Report) {
  visit(tree, (node) => {
    if (node.type !== 'emphasis' && node.type !== 'strong') return;
    if (!node.position || source[node.position.start.offset ?? -1] !== '_') return;
    const [marker, fix] = node.type === 'emphasis' ? ['_', '*text*'] : ['__', '**text**'];
    report({
      rule: 'emphasis-marker',
      severity: 'warning',
      message: `${node.type === 'emphasis' ? 'Emphasis' : 'Strong'} uses \`${marker}\`; use ${fix}, as the editor writes it.`,
      start: pointOf(node.position.start),
      end: pointOf(node.position.end),
    });
  });
}
