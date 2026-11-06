// The note syntax the site renders, in one place: the directive plugin
// (packages/mdx/src/remark-notes-directives.ts), the callout and accordion components and
// the Notes Studio lint (packages/server/src/lint) all read these lists.
// No imports, so Node can load this file as is (the Studio server, node --test).

// `:::name` container directives that become a <Callout type="name">.
export const CALLOUT_DIRECTIVES = [
  'caution',
  'danger',
  'error',
  'example',
  'important',
  'info',
  'note',
  'success',
  'tip',
  'warn',
  'warning',
] as const;

// `type` values <Callout> knows: every directive name, plus `idea`, which only
// JSX can spell.
export const CALLOUT_TYPES = [...CALLOUT_DIRECTIVES, 'idea'] as const;

export type CalloutType = (typeof CALLOUT_TYPES)[number];

// `kind` of an accordion (`:::accordion{kind=…}` or <Accordion kind>).
export const ACCORDION_KINDS = ['question', 'deep-dive', 'definition', 'example', 'tip', 'warning', 'danger', 'note'] as const;

export type AccordionKind = (typeof ACCORDION_KINDS)[number];

// Directive names the directive plugin turns into components. Any other
// directive is written back as plain text.
export const CONTAINER_DIRECTIVES = [...CALLOUT_DIRECTIVES, 'accordion', 'accordions', 'tabs', 'tab', 'steps', 'step'] as const;
export const LEAF_DIRECTIVES = ['youtube', 'html', 'svg', 'diagram'] as const;
export const TEXT_DIRECTIVES = ['graph-meta', 'keyword', 'tag'] as const;
