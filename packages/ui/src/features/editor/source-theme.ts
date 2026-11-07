import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

// The look of CodeMirror in the Studio: Source and the raw diff.
// Colours come from the editor's --fde-* tokens, so light and dark follow
// whatever theme the editor resolved.
export const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '600' },
  { tag: [tags.emphasis], fontStyle: 'italic' },
  { tag: [tags.strong], fontWeight: '600' },
  { tag: [tags.meta, tags.comment, tags.processingInstruction], color: 'var(--fde-hl-comment)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--fde-hl-tag)' },
  { tag: [tags.attributeName, tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--fde-hl-attr)' },
  { tag: [tags.string, tags.attributeValue, tags.url], color: 'var(--fde-hl-string)' },
  { tag: [tags.link], color: 'var(--fde-hl-attr)', textDecoration: 'underline' },
  { tag: [tags.monospace], color: 'var(--fde-hl-type)' },
  { tag: [tags.keyword], color: 'var(--fde-hl-keyword)' },
]);

export const theme = EditorView.theme({
  '&': { color: 'var(--fde-foreground)', backgroundColor: 'transparent', height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
  '.cm-content': { caretColor: 'var(--fde-foreground)', padding: '14px 0' },
  '.cm-gutters': { backgroundColor: 'var(--fde-card)', color: 'var(--fde-muted-foreground)', borderRight: '1px solid var(--fde-border)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--fde-accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--fde-accent) !important' },
  // A picked lint issue: drawn over the text, so the active line cannot hide it.
  '.cm-lint-reveal': {
    backgroundColor: 'color-mix(in srgb, var(--fde-error) 22%, transparent)',
    borderBottom: '2px solid var(--fde-error)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--fde-foreground)' },
  '.cm-panels': { backgroundColor: 'var(--fde-card)', color: 'var(--fde-foreground)' },
  '.cm-tooltip': { backgroundColor: 'var(--fde-popover)', color: 'var(--fde-popover-foreground)', border: '1px solid var(--fde-border)', borderRadius: '8px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', fontSize: '12.5px', maxWidth: 'min(40rem, 90vw)', padding: '4px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { borderRadius: '5px', padding: '2px 8px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--fde-accent)', color: 'var(--fde-accent-foreground)' },
  '.cm-completionDetail': { fontFamily: 'var(--font-sans)', fontStyle: 'normal', fontSize: '11.5px', color: 'var(--fde-muted-foreground)', marginLeft: '10px' },
});
