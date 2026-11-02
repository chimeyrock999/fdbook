import { autoUpdate, computePosition, flip, offset, shift, type VirtualElement } from '@floating-ui/dom';
import { posToDOMRect } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { useLayoutEffect, type RefObject } from 'react';

const GAP = 6;

// The editor's scroller, where a popup flips; the window otherwise.
function scrollerOf(element: HTMLElement): HTMLElement | undefined {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return undefined;
}

// Places `floating` (fixed) under the document range `from`–`to` (a
// marker), above it with no room below, and keeps it there while the page
// scrolls, the editor changes or `floating` changes size.
export function usePlaceAt(view: EditorView, floating: RefObject<HTMLElement | null>, from: number, to: number) {
  useLayoutEffect(() => {
    const element = floating.current;
    if (!element) return;
    const reference: VirtualElement = {
      getBoundingClientRect: () => posToDOMRect(view, Math.min(from, view.state.doc.content.size), Math.min(to, view.state.doc.content.size)),
      contextElement: view.dom,
    };
    const boundary = scrollerOf(view.dom);
    const place = () => {
      void computePosition(reference, element, {
        strategy: 'fixed',
        placement: 'bottom-start',
        middleware: [offset(GAP), flip(boundary ? { boundary } : {}), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        element.style.left = `${String(x)}px`;
        element.style.top = `${String(y)}px`;
      });
    };
    return autoUpdate(reference, element, place);
  }, [view, floating, from, to]);
}
