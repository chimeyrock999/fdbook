import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { useSourceText } from '@fumadocs-editor/ui';
import { tags } from '@lezer/highlight';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { revealField, revealRange, type RevealRequest } from './reveal';

// Colours come from the editor's --fde-* tokens, so light and dark follow
// whatever theme the editor resolved.
const highlight = HighlightStyle.define([
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

const theme = EditorView.theme({
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
});

const locked = (readOnly: boolean) => [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];

// The note's MDX in CodeMirror 6, bound to the editor's source text: typing
// here parses back into the document once it parses; visual edits and disk
// changes arrive as new text. `reveal` selects a range (a lint issue).
export function SourceEditor({ reveal = null }: { reveal?: RevealRequest | null }) {
  const { value, onChange, error, readOnly } = useSourceText();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const editable = useRef(new Compartment());
  const latest = useRef({ onChange, value, readOnly });
  useLayoutEffect(() => {
    latest.current = { onChange, value, readOnly };
  });

  useEffect(() => {
    if (!host.current) return;
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          revealField,
          search({ top: true }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          yamlFrontmatter({ content: markdown() }),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          theme,
          editable.current.of(locked(latest.current.readOnly)),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const text = update.state.doc.toString();
            if (text !== latest.current.value) latest.current.onChange(text);
          }),
        ],
      }),
    });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
  }, []);

  // Text from elsewhere (visual edits, the form, the disk): replace only the
  // span that differs, so the caret and scroll stay put, and keep it out of
  // the undo history so Cmd-Z never reverts someone else's change.
  useEffect(() => {
    const current = view.current;
    if (!current) return;
    const text = current.state.doc.toString();
    if (text === value) return;
    let start = 0;
    while (start < text.length && start < value.length && text[start] === value[start]) start++;
    let end = 0;
    while (
      end < text.length - start &&
      end < value.length - start &&
      text[text.length - 1 - end] === value[value.length - 1 - end]
    )
      end++;
    current.dispatch({
      changes: { from: start, to: text.length - end, insert: value.slice(start, value.length - end) },
      annotations: Transaction.addToHistory.of(false),
    });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure(locked(readOnly)) });
  }, [readOnly]);

  // After the text effect above, so a freshly opened Source has the text.
  useEffect(() => {
    if (reveal && view.current) revealRange(view.current, reveal.start, reveal.end);
  }, [reveal]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error !== null && (
        <p role="alert" className="mx-4 mt-3 rounded-lg border border-[var(--fde-error)] px-3 py-1.5 text-[13px] text-[var(--fde-error)]">
          Does not parse: {error}. Fix it here to go back to Visual.
        </p>
      )}
      <div ref={host} className="min-h-0 flex-1 overflow-auto" data-testid="source-editor" />
    </div>
  );
}
