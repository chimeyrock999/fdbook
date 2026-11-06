import { Plugin, PluginKey } from '@tiptap/pm/state';
import { useSyncExternalStore } from 'react';
import { blocksOf, lineAt } from '@fdbook/shared/hunks.ts';
import type { MessageSelection } from '#api/agents.ts';

// Where a person is in the editor, for the agent panel: the note open (a
// worktree path), the lines selected there, or else the caret's line.
// `selection` is the editor's last one: it stays when focus moves to the
// chat, and goes when it collapses to a caret or the note closes (#86).
export type EditorPlace = { note: string; selection: MessageSelection | null; caret: number | null };

// What a selection in Source needs of the note's text: CodeMirror's Text,
// which finds a line without copying the note.
export type SourceLines = { lineAt: (offset: number) => { number: number; from: number; to: number }; sliceString: (from: number, to?: number) => string };

// A selection in Source, from..to in the note's text: whole lines, and the
// text selected in them. One that ends at a line's start ends on the line before.
export function sourceSelection(doc: SourceLines, from: number, to: number): MessageSelection {
  const first = doc.lineAt(from);
  const last = doc.lineAt(to > from ? to - 1 : to);
  return { lines: [first.number, last.number], source: doc.sliceString(first.from, last.to), text: doc.sliceString(from, to) };
}

// A selection in Visual, over the document's top-level blocks first..last:
// the lines of those blocks in the note's text (the document holds its
// blocks in the order blocksOf finds them, the frontmatter first), and the
// text selected. Null when the text does not parse, or is a keystroke
// behind the document and has no such blocks.
export function blockSelection(text: string, first: number, last: number, selected: string): MessageSelection | null {
  let blocks;
  try {
    blocks = blocksOf(text);
  } catch {
    return null;
  }
  return selectionOfBlocks(text, blocks, first, last, selected);
}

// blockSelection on the note's blocks as blocksOf found them.
export function selectionOfBlocks(text: string, blocks: ReturnType<typeof blocksOf>, first: number, last: number, selected: string): MessageSelection | null {
  const a = blocks.at(first);
  const b = blocks.at(last);
  if (first < 0 || a === undefined || b === undefined || last < first) return null;
  const end = text[b.end - 1] === '\n' ? b.end - 1 : b.end;
  return { lines: [lineAt(text, a.start), lineAt(text, Math.max(a.start, end - 1))], source: text.slice(a.start, end), text: selected };
}

// The first line of the block at `index` (the caret's block in Visual), or null.
export function blockLine(text: string, index: number) {
  try {
    const block = blocksOf(text).at(index);
    return block === undefined || index < 0 ? null : lineAt(text, block.start);
  } catch {
    return null;
  }
}

// What the Visual editor's selection is, by top-level block.
export type VisualSelection = { first: number; last: number; text: string } | { caret: number };

// A ProseMirror plugin that tells `onChange` of every new selection, and of
// the document changing under it.
export function selectionPlugin(onChange: (selection: VisualSelection) => void) {
  return new Plugin({
    key: new PluginKey('studioEditorPlace'),
    view(view) {
      const report = () => {
        const { selection, doc } = view.state;
        const first = doc.resolve(selection.from).index(0);
        if (selection.empty) onChange({ caret: first });
        else onChange({ first, last: doc.resolve(Math.max(selection.from, selection.to - 1)).index(0), text: doc.textBetween(selection.from, selection.to, '\n') });
      };
      report();
      return {
        update(next, previous) {
          if (next.state.selection.eq(previous.selection) && next.state.doc === previous.doc) return;
          report();
        },
      };
    },
  });
}

const same = (a: EditorPlace | null, b: EditorPlace | null) =>
  a === b || (a !== null && b !== null && a.note === b.note && a.caret === b.caret && (a.selection === b.selection || (
    a.selection !== null && b.selection !== null && a.selection.lines[0] === b.selection.lines[0] && a.selection.lines[1] === b.selection.lines[1] && a.selection.source === b.selection.source && a.selection.text === b.selection.text
  )));

export function createEditorPlaces() {
  let place: EditorPlace | null = null;
  const listeners = new Set<() => void>();
  const set = (next: EditorPlace | null) => {
    if (same(place, next)) return;
    place = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => place,
    set,
    // Clears the place only if it is still `note`'s (a note closing after the next one opened).
    clear: (note: string) => { if (place?.note === note) set(null); },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

// The page's one editor place: the editor sets it, the agent panel reads it.
export const editorPlaces = createEditorPlaces();

export function useEditorPlace() {
  return useSyncExternalStore(editorPlaces.subscribe, editorPlaces.get);
}
