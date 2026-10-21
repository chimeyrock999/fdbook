import type { AccordionKind } from './notes-syntax';

// Each accordion "kind" borrows the matching callout palette so the collapsible
// blocks read as the softer, unverified sibling of the inline callouts. Used by
// components/accordion.tsx and the Notes Studio's accordion cards.
export const accordionKindSemantic: Record<AccordionKind, string> = {
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
