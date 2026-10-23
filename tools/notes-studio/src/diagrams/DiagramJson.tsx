import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { highlight, theme } from '../editor/source-theme';

const locked = (readOnly: boolean) => [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];

// The diagram file as JSON in CodeMirror 6, as a note's Source is: typing
// changes the drawing once the text parses; edits on the canvas and changes
// on disk arrive as new text, kept out of this editor's undo history (the
// page's Undo covers both views).
export function DiagramJson({ value, onChange, readOnly, invalid }: { value: string; onChange: (text: string) => void; readOnly: boolean; invalid: boolean }) {
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
          search({ top: true }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          syntaxHighlighting(highlight),
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

  // Replace only the span that differs, so the caret and scroll stay put.
  useEffect(() => {
    const current = view.current;
    if (!current) return;
    const text = current.state.doc.toString();
    if (text === value) return;
    let start = 0;
    while (start < text.length && start < value.length && text[start] === value[start]) start++;
    let end = 0;
    while (end < text.length - start && end < value.length - start && text[text.length - 1 - end] === value[value.length - 1 - end]) end++;
    current.dispatch({
      changes: { from: start, to: text.length - end, insert: value.slice(start, value.length - end) },
      annotations: Transaction.addToHistory.of(false),
    });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure(locked(readOnly)) });
  }, [readOnly]);

  return (
    <div className="studio-dg-json">
      {invalid && <p role="alert" className="studio-dg-json-error">Not valid JSON yet: it is saved once it parses.</p>}
      <div ref={host} className="min-h-0 flex-1 overflow-auto" data-testid="diagram-json" />
    </div>
  );
}
