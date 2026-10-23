import { autocompletion, type CompletionSource } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Transaction, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { useSourceText } from '@fumadocs-editor/ui';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { revealField, revealRange, type RevealRequest } from './reveal';
import { highlight, theme } from './source-theme';

const locked = (readOnly: boolean) => [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];

// The note's MDX in CodeMirror 6, bound to the editor's source text: typing
// here parses back into the document once it parses; visual edits and disk
// changes arrive as new text. `reveal` selects a range (a lint issue);
// `completion` suggests values as they are typed (asset paths); `extra`
// draws more over the text (agent suggestions, src/suggestions/source.ts).
export function SourceEditor({ reveal = null, completion = null, extra = null }: { reveal?: RevealRequest | null; completion?: CompletionSource | null; extra?: Extension | null }) {
  const { value, onChange, error, readOnly } = useSourceText();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const editable = useRef(new Compartment());
  const extras = useRef(new Compartment());
  const latest = useRef({ onChange, value, readOnly, completion });
  useLayoutEffect(() => {
    latest.current = { onChange, value, readOnly, completion };
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
          autocompletion({ override: [(context) => latest.current.completion?.(context) ?? null], icons: false }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          yamlFrontmatter({ content: markdown() }),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          theme,
          editable.current.of(locked(latest.current.readOnly)),
          extras.current.of([]),
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

  // After the text effect above, so what it draws finds the text it is for.
  useEffect(() => {
    view.current?.dispatch({ effects: extras.current.reconfigure(extra ?? []) });
  }, [extra]);

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
