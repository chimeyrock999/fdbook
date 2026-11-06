import { CALLOUT_DIRECTIVES, CALLOUT_TYPES as SITE_CALLOUT_TYPES } from '@fdbook/mdx/notes-syntax.ts';

// The site's callout types (lib/notes-syntax.ts) in menu order: mild to
// severe. A type the order does not know yet goes last.
const ORDER = ['note', 'info', 'tip', 'idea', 'example', 'success', 'warn', 'warning', 'caution', 'important', 'danger', 'error'];
function rank(type: string) {
  const index = ORDER.indexOf(type);
  return index < 0 ? ORDER.length : index;
}
const inMenuOrder = (types: readonly string[]) => [...types].sort((a, b) => rank(a) - rank(b));

// `<Callout type="…">`.
export const CALLOUT_TYPES = inMenuOrder(SITE_CALLOUT_TYPES);

// `:::name` callouts: every type but `idea`, which only JSX spells.
export const DIRECTIVE_TYPES = inMenuOrder(CALLOUT_DIRECTIVES);
