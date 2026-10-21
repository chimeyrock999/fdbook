import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

const setReveal = StateEffect.define<{ from: number; to: number }>();
const mark = Decoration.mark({ class: 'cm-lint-reveal' });

// The range of the last picked lint issue, marked until the text changes.
export const revealField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setReveal)) {
        const { from, to } = effect.value;
        return from < to ? Decoration.set([mark.range(from, to)]) : Decoration.none;
      }
    }
    return transaction.docChanged ? Decoration.none : marks;
  },
  provide: (field) => EditorView.decorations.from(field),
});

type Place = { line: number; column: number };

// A line and column of the text as the lint saw it, as an offset into the
// editor. Lines and columns survive CodeMirror turning CRLF into LF;
// offsets would not. Out-of-range places are clamped.
function offsetOf(view: EditorView, { line, column }: Place) {
  const { doc } = view.state;
  const target = doc.line(Math.min(Math.max(line, 1), doc.lines));
  return target.from + Math.min(Math.max(column - 1, 0), target.length);
}

// Selects the range, marks it and scrolls it to the middle.
export function revealRange(view: EditorView, start: Place, end: Place) {
  const anchor = offsetOf(view, start);
  const head = Math.max(offsetOf(view, end), anchor);
  view.dispatch({
    selection: { anchor, head },
    effects: [EditorView.scrollIntoView(anchor, { y: 'center' }), setReveal.of({ from: anchor, to: head })],
  });
  view.focus();
}

// A request to select a range; `seq` makes picking the same range again count.
export type RevealRequest = { start: Place; end: Place; seq: number };
