import { CALLOUT_DIRECTIVES, CALLOUT_TYPES as SITE_CALLOUT_TYPES } from '@site/lib/notes-syntax';
import { Bird, Bug, Droplet, Flower2, Leaf, Rat, Snail, Sprout, type LucideIcon } from 'lucide-react';

// The callout types and looks of components/notes-callout.tsx.
export type SemanticType = 'caution' | 'danger' | 'example' | 'idea' | 'info' | 'note' | 'success' | 'warning';

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

export function semanticType(type: string | undefined): SemanticType {
  switch (type) {
    case 'tip':
      return 'idea';
    case 'caution':
    case 'important':
      return 'caution';
    case 'warn':
    case 'warning':
      return 'warning';
    case 'danger':
    case 'error':
      return 'danger';
    case 'example':
    case 'idea':
    case 'info':
    case 'note':
    case 'success':
      return type;
    default:
      return 'info';
  }
}

export const ICONS: Record<SemanticType, LucideIcon> = {
  caution: Snail,
  danger: Rat,
  example: Leaf,
  idea: Sprout,
  info: Bird,
  note: Droplet,
  success: Flower2,
  warning: Bug,
};
