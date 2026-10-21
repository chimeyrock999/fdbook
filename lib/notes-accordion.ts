import { Bug, CircleHelp, Droplet, Leaf, type LucideIcon, Rat, Shovel, Sprout, Tag } from 'lucide-react';
import type { SemanticCalloutType } from '../components/notes-callout';
import type { AccordionKind } from './notes-syntax';

// The look of an accordion item per kind, used by components/accordion.tsx
// and the Notes Studio's accordion cards.

// Garden-concept icon set, sourced from lucide but kept on the plants/garden
// metaphor: a question sprout, a trowel to dig, a tag, a leaf, a sprout, and
// the garden pests (bug → rat) escalating in severity, plus a water droplet.
export const accordionKindIcons = {
  question: CircleHelp,
  'deep-dive': Shovel,
  definition: Tag,
  example: Leaf,
  tip: Sprout,
  warning: Bug,
  danger: Rat,
  note: Droplet,
} satisfies Record<AccordionKind, LucideIcon>;

// Each accordion "kind" borrows the matching callout palette so the collapsible
// blocks read as the softer, unverified sibling of the inline callouts.
export const accordionKindSemantic: Record<AccordionKind, SemanticCalloutType> = {
  danger: 'danger',
  'deep-dive': 'example',
  definition: 'note',
  example: 'example',
  note: 'note',
  question: 'info',
  tip: 'idea',
  warning: 'warning',
};

// The `--acc-*` variables an accordion item draws with.
export function accordionKindVariables(kind: AccordionKind | undefined): Record<string, string> {
  const semantic = kind ? accordionKindSemantic[kind] : 'note';
  return {
    '--acc-title': `var(--color-callout-${semantic}-title)`,
    '--acc-line': `var(--color-callout-${semantic})`,
    '--acc-tint': `var(--color-callout-${semantic}-bg)`,
    '--acc-border': `color-mix(in oklab, var(--color-callout-${semantic}) 46%, var(--color-fd-border))`,
  };
}
