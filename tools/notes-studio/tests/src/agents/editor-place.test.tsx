// @vitest-environment jsdom
import { Text } from '@codemirror/state';
import { useSourceText } from '@fumadocs-editor/ui';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorPlaces, editorPlaces } from '../../../src/agents/editor-place';
import { useReportPlace } from '../../../src/editor/report-place';
import { mountVisual, stubLayout, textAt } from '../../support/visual-editor';

const NOTE = 'content/notes/guide/first-look.mdx';
const TEXT = '---\ntitle: First look\n---\n\nA first look.\n\nTwo\nlines here.\n\n- one\n- two\n';
const DOC = Text.of(TEXT.split('\n'));

afterEach(() => {
  cleanup();
  editorPlaces.set(null);
});

describe('editor place', () => {
  it('tells only a change, and clears only its own note', () => {
    const places = createEditorPlaces();
    const heard = vi.fn();
    places.subscribe(heard);
    places.set({ note: NOTE, selection: null, caret: 3 });
    places.set({ note: NOTE, selection: null, caret: 3 });
    expect(heard).toHaveBeenCalledTimes(1);
    places.clear('content/notes/other.mdx');
    expect(places.get()).not.toBeNull();
    places.clear(NOTE);
    expect(places.get()).toBeNull();
  });

  it('follows the Visual editor: the blocks selected, the caret, and stays when focus leaves', async () => {
    stubLayout();
    function Reporter({ container }: { container: RefObject<HTMLElement | null> }) {
      useReportPlace(container, NOTE, useSourceText().value, true);
      return null;
    }
    const { editor } = await mountVisual(TEXT, { extra: (container) => <Reporter container={container} /> });
    act(() => { editor.commands.setTextSelection({ from: textAt(editor, 'first'), to: textAt(editor, 'lines') + 5 }); });
    await vi.waitFor(() => { expect(editorPlaces.get()).toEqual({ note: NOTE, selection: { lines: [5, 8], source: 'A first look.\n\nTwo\nlines here.', text: 'first look.\nTwo lines' }, caret: null }); });
    // Focus going to the chat leaves the editor's selection as it was.
    act(() => { editor.commands.blur(); });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(editorPlaces.get()?.selection?.lines).toEqual([5, 8]);
    act(() => { editor.commands.setTextSelection(textAt(editor, 'one')); });
    await vi.waitFor(() => { expect(editorPlaces.get()).toEqual({ note: NOTE, selection: null, caret: 10 }); });
  });

  it('follows the Source editor at once, and goes when the note closes', () => {
    const container = { current: null };
    const { result, unmount } = renderHook(() => useReportPlace(container, NOTE, TEXT, true));
    act(() => { result.current(TEXT.indexOf('Two'), TEXT.indexOf('here') + 4, DOC); });
    expect(editorPlaces.get()).toEqual({ note: NOTE, selection: { lines: [7, 8], source: 'Two\nlines here.', text: 'Two\nlines here' }, caret: null });
    act(() => { result.current(TEXT.indexOf('one'), TEXT.indexOf('one'), DOC); });
    expect(editorPlaces.get()).toEqual({ note: NOTE, selection: null, caret: 10 });
    unmount();
    expect(editorPlaces.get()).toBeNull();
  });

  it('tells nothing before the note is open', () => {
    const container = { current: null };
    const { result } = renderHook(() => useReportPlace(container, NOTE, TEXT, false));
    act(() => { result.current(0, 3, DOC); });
    expect(editorPlaces.get()).toBeNull();
  });
});
