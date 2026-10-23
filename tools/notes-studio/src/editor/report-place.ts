import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { blockLine, blockSelection, editorPlaces, selectionPlugin, sourceSelection, type SourceLines, type VisualSelection } from '../agents/editor-place';
import { useEditorPlugin } from './decorations';

// How long the Visual selection settles before its lines are worked out:
// that parses the note, and its text may be a keystroke behind.
const SETTLE_MS = 120;

// Tells the agent panel where the person is in the note `note` (a worktree
// path) open in `container` (#86): the Visual editor's selection through
// a ProseMirror plugin, the Source editor's through the callback answered,
// for SourceEditor's `onSelect`. `text` is the note as the editor holds
// it; nothing is told until it is `opened`. The place goes when the note
// closes.
export function useReportPlace(container: RefObject<HTMLElement | null>, note: string, text: string, opened: boolean) {
  const latest = useRef({ note, text, opened });
  useLayoutEffect(() => {
    latest.current = { note, text, opened };
  });
  const pending = useRef<VisualSelection | null>(null);
  // The Visual selection did not fit the text (a keystroke behind): it is
  // worked out again when the text changes.
  const unplaced = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const settle = useCallback(() => {
    const visual = pending.current;
    const { note: path, text: source, opened: open } = latest.current;
    if (visual === null || !open) return;
    const selection = 'caret' in visual ? null : blockSelection(source, visual.first, visual.last, visual.text);
    unplaced.current = 'caret' in visual ? false : selection === null;
    // Not placed yet: no selection rather than the last one, which is gone.
    editorPlaces.set({ note: path, selection, caret: 'caret' in visual ? blockLine(source, visual.caret) : null });
  }, []);

  const plugin = useMemo(() => selectionPlugin((visual) => {
    pending.current = visual;
    clearTimeout(timer.current);
    timer.current = setTimeout(settle, SETTLE_MS);
  }), [settle]);
  useEditorPlugin(container, plugin);

  // The note just opened: what Visual said before counts now.
  useEffect(() => { if (opened) settle(); }, [opened, settle]);
  // The text caught up with the document.
  useEffect(() => { if (unplaced.current) settle(); }, [text, settle]);

  useEffect(() => () => {
    clearTimeout(timer.current);
    editorPlaces.clear(note);
  }, [note]);

  return useCallback((from: number, to: number, doc: SourceLines) => {
    // Source on screen: a Visual selection waiting to settle is gone.
    clearTimeout(timer.current);
    pending.current = null;
    unplaced.current = false;
    const { note: path, opened: open } = latest.current;
    if (!open) return;
    editorPlaces.set(from === to ? { note: path, selection: null, caret: doc.lineAt(from).number } : { note: path, selection: sourceSelection(doc, from, to), caret: null });
  }, []);
}
