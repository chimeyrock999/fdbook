import { MdxEditor, type BubbleItem, type MdxEditorRef } from '@fumadocs-editor/ui';
import type { AnyExtension, Editor } from '@tiptap/core';
import { act, render } from '@testing-library/react';
import { createRef, useRef, type ReactNode } from 'react';
import { vi } from 'vitest';
import { editorConfig } from '#plugins/index.ts';
import { defined } from './editor-state';

// jsdom has none of these: the editor sizes menus and places popups from
// the selection's rectangles (matchMedia comes from tests/setup/jsdom.ts).
export function stubLayout() {
  vi.stubGlobal('ResizeObserver', class {
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
  });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

function Visual({ children }: { children: (container: React.RefObject<HTMLElement | null>) => ReactNode }) {
  const container = useRef<HTMLElement>(null);
  return (
    <section ref={container}>
      <MdxEditor.Visual />
      {children(container)}
    </section>
  );
}

// The Visual editor with the Studio's plugins, as NoteEditor mounts it, plus
// the `extensions` given and whatever `extra` draws next to it (e.g. the
// graph tools). Resolves once the live editor replaced the static first paint.
export async function mountVisual(source: string, { editable = true, extensions, bubbleItems, extra }: {
  editable?: boolean;
  extensions?: AnyExtension[];
  bubbleItems?: BubbleItem[];
  extra?: (container: React.RefObject<HTMLElement | null>) => ReactNode;
} = {}) {
  const ref = createRef<MdxEditorRef>();
  const result = render(
    <MdxEditor.Root defaultValue={source} ref={ref} components={editorConfig.components} syntax={editorConfig.syntax} extensions={extensions} bubbleItems={bubbleItems} editable={editable}>
      <Visual>{(container) => extra?.(container)}</Visual>
    </MdxEditor.Root>,
  );
  const prose = await vi.waitFor(() => {
    const found = defined(result.container.querySelector<HTMLElement & { editor?: Editor }>('.ProseMirror[contenteditable]'), 'editor');
    return { element: found, editor: defined(found.editor, 'live editor') };
  }, { timeout: 3000 });
  const { editor } = prose;
  const markdown = () => defined(ref.current).getMarkdown();
  // The editor writes on a short debounce.
  const written = (expected: string) => vi.waitFor(() => {
    if (markdown() !== expected) throw new Error(`still ${JSON.stringify(markdown())}`);
  }, { timeout: 2000 });
  const key = (key: string, init: KeyboardEventInit = {}) => {
    act(() => { prose.element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })); });
  };
  return { ...result, prose: prose.element, editor, markdown, written, key };
}

// The position of the n-th `needle` in the editor's text.
export function textAt(editor: Editor, needle: string, nth = 0) {
  let found = -1;
  let seen = 0;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1 || !node.isText) return;
    let index = (node.text ?? '').indexOf(needle);
    while (index !== -1) {
      if (seen++ === nth) {
        found = pos + index;
        return;
      }
      index = (node.text ?? '').indexOf(needle, index + 1);
    }
  });
  if (found === -1) throw new Error(`no "${needle}"`);
  return found;
}
