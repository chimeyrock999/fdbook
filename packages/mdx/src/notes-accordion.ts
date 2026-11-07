import { Birdhouse, BroomSparkles, Construction, Fan, Groceries, type LucideIcon, Pickaxe, Snowflake, Sun } from 'lucide-react';
import type { SemanticCalloutType } from '../components/notes-callout.tsx';
import type { AccordionKind } from './notes-syntax';

// The look of an accordion item per kind, used by components/accordion.tsx
// and the Notes Studio's accordion cards.

// Garden-chore icon set, sourced from lucide: a birdhouse for questions, a
// pickaxe to dig, a fan for definitions, a basket of groceries for examples,
// sun for tips, frost and a roadblock for warning and danger, a broom for
// notes.
export const accordionKindIcons = {
  question: Birdhouse,
  'deep-dive': Pickaxe,
  definition: Fan,
  example: Groceries,
  tip: Sun,
  warning: Snowflake,
  danger: Construction,
  note: BroomSparkles,
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

// The `--acc-*` variables an accordion item draws with: the kind's colour
// mixed into the page background at a strength per part, so dark mode
// follows without its own values.
export function accordionKindVariables(kind: AccordionKind | undefined): Record<string, string> {
  const semantic = kind ? accordionKindSemantic[kind] : 'note';
  const mix = (percent: number) => `color-mix(in oklab, var(--color-callout-${semantic}) ${String(percent)}%, var(--color-fd-background))`;
  return {
    '--acc-title': `var(--color-callout-${semantic}-title)`,
    '--acc-border': mix(60),
    '--acc-tint': mix(12),
    '--acc-badge': mix(22),
    '--acc-line': mix(35),
    '--acc-body': mix(4),
  };
}
