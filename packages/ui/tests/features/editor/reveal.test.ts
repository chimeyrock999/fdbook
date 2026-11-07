// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { revealField, revealRange } from '#features/editor/reveal.ts';

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

function open(doc: string) {
  view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: [revealField] }) });
  return view;
}

describe('revealRange', () => {
  it('selects the range and focuses the editor', () => {
    const editor = open('# T\n\n<Nope/>\nx\n');
    revealRange(editor, { line: 3, column: 1 }, { line: 3, column: 8 });
    const { from, to } = editor.state.selection.main;
    expect(editor.state.sliceDoc(from, to)).toBe('<Nope/>');
    expect(editor.hasFocus).toBe(true);
    expect(editor.dom.querySelector('.cm-lint-reveal')?.textContent).toBe('<Nope/>');
  });

  it('drops the mark once the text changes', () => {
    const editor = open('# T\n\n<Nope/>\n');
    revealRange(editor, { line: 3, column: 1 }, { line: 3, column: 8 });
    editor.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(editor.dom.querySelector('.cm-lint-reveal')).toBeNull();
  });

  it('finds the range in a CRLF note, which the editor holds with LF', () => {
    const editor = open('# T\r\n\r\n<Nope/>\r\nx\r\n');
    revealRange(editor, { line: 3, column: 1 }, { line: 3, column: 8 });
    const { from, to } = editor.state.selection.main;
    expect(editor.state.sliceDoc(from, to)).toBe('<Nope/>');
  });

  it('clamps a range past the end of a text that has since shrunk', () => {
    const editor = open('short');
    revealRange(editor, { line: 9, column: 1 }, { line: 9, column: 20 });
    expect(editor.state.selection.main).toMatchObject({ from: 0, to: 5 });
  });
});
