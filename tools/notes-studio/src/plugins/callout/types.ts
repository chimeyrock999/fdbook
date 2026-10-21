import { Bird, Bug, Droplet, Flower2, Leaf, Rat, Snail, Sprout, type LucideIcon } from 'lucide-react';

// The callout types and looks of components/notes-callout.tsx.
export type SemanticType = 'caution' | 'danger' | 'example' | 'idea' | 'info' | 'note' | 'success' | 'warning';

// `<Callout type="…">` as the site types it.
export const CALLOUT_TYPES = [
  'note', 'info', 'tip', 'idea', 'example', 'success', 'warn', 'warning', 'caution', 'important', 'danger', 'error',
];

// `:::name` callouts: the names lib/remark-notes-directives.ts turns into a
// Callout (every type but `idea`, which only JSX spells), in menu order.
export const DIRECTIVE_TYPES = CALLOUT_TYPES.filter((type) => type !== 'idea');

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
