import { autoUpdate, computePosition, flip, offset, shift, type VirtualElement } from '@floating-ui/dom';
import { posToDOMRect } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

// Where the graph popups go next to the editor's own format bubble.
//
// The bubble (@fumadocs-editor/ui 0.7.0) is a tiptap BubbleMenu: shown, it
// is appended to the editor frame, placed "bottom-start" 6px from the
// selection and flipped above when there is no room below; hidden, it is
// removed. Its `bubbleItems` (fuma-nama/fumadocs-editor#40) are buttons for
// a text selection only, while the graph bar also shows for a caret on a
// marker or a heading and carries the fields and the frontmatter note, so
// the bar stays a popup of its own. The editor gives no way to find the
// bubble, so the popups find it among the children of the editor's
// ancestors and anchor to the box around the selection and the bubble.
// Placed below that box, they sit under the bubble when the bubble is
// under the selection and under the selection when it flipped above; with
// no room below they go above it.

const GAP = 6;
// How long to wait for the bubble after the selection changed (BubbleMenu
// updates 150ms late), so a popup does not jump when it appears.
const BUBBLE_DELAY = 200;

export type Docked = 'bubble' | 'selection';

// Visible, positioned elements appended next to the editor, on the way from
// `view.dom` up to `root`: where tiptap puts the bubble.
function candidates(view: EditorView, root: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let parent = view.dom.parentElement; parent; parent = parent.parentElement) {
    for (const child of parent.children) {
      if (!(child instanceof HTMLElement) || child.contains(view.dom)) continue;
      const { position, visibility } = child.style;
      if ((position === 'absolute' || position === 'fixed') && visibility === 'visible') found.push(child);
    }
    if (parent === root) break;
  }
  return found;
}

// The editor's bubble near the selection, if it is shown.
export function findBubble(view: EditorView, root: HTMLElement, among = candidates(view, root)): HTMLElement | null {
  const selection = selectionRect(view);
  let best: { element: HTMLElement; distance: number } | null = null;
  for (const child of among) {
    const rect = child.getBoundingClientRect();
    const distance = rect.top >= selection.bottom ? rect.top - selection.bottom : selection.top - rect.bottom;
    if (distance < -1 || distance > 48) continue;
    if (!best || distance < best.distance) best = { element: child, distance };
  }
  return best?.element ?? null;
}

// The selection's box as BubbleMenu measures it.
function selectionRect(view: EditorView) {
  const { from, to } = view.state.selection;
  return posToDOMRect(view, from, to);
}

// The box around the selection and the bubble.
export function anchorRect(selection: DOMRect, bubble: DOMRect | null): DOMRect {
  if (!bubble) return selection;
  const left = Math.min(selection.left, bubble.left);
  const top = Math.min(selection.top, bubble.top);
  return new DOMRect(left, top, Math.max(selection.right, bubble.right) - left, Math.max(selection.bottom, bubble.bottom) - top);
}

// The editor's scroller, where the bubble flips; the window otherwise.
function scrollerOf(element: HTMLElement): HTMLElement | undefined {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return undefined;
}

// Places `floating` (fixed) against the selection and the editor's bubble,
// and keeps it there while either moves, the page scrolls or `floating`
// changes size. `key` changes with the selection. With `wait` (a selection
// the bubble shows for), a new key keeps the popup hidden until the bubble
// is placed or BUBBLE_DELAY passes; a bubble sliding to a new place (it has
// a 200ms transition on top/left) hides it too, until the slide ends.
export function useDock(view: EditorView, root: RefObject<HTMLElement | null>, floating: RefObject<HTMLElement | null>, key: string, wait: boolean) {
  const [docked, setDocked] = useState<Docked>('selection');
  // The last key the popup was placed for, and whether the bubble is moving.
  // Derived during render, so a new selection never paints a stale frame.
  const [settled, setSettled] = useState<string | null>(null);
  const [sliding, setSliding] = useState(false);
  const waiting = wait && (settled !== key || sliding);

  useEffect(() => {
    if (!wait) return;
    const timer = setTimeout(() => { setSettled(key); }, BUBBLE_DELAY);
    return () => { clearTimeout(timer); };
  }, [key, wait]);

  useLayoutEffect(() => {
    const element = floating.current;
    const container = root.current;
    if (!element || !container) return;
    let bubble = findBubble(view, container);
    const reference: VirtualElement = {
      getBoundingClientRect: () => anchorRect(selectionRect(view), bubble?.getBoundingClientRect() ?? null),
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
    // The bubble moves by its inline style, then slides there. BubbleMenu
    // appends it before it places it, so every candidate is watched: the
    // bubble may reach the selection only after it was appended. Its box is
    // read again once a slide ends, where it really is.
    const watchStyles = new MutationObserver(() => { refresh(); });
    let listening = new AbortController();
    const refresh = () => {
      // A slide still running starts again with transitionrun; one whose
      // bubble was removed never ends, so it is not left waiting.
      setSliding(false);
      const among = candidates(view, container);
      bubble = findBubble(view, container, among);
      watchStyles.disconnect();
      listening.abort();
      listening = new AbortController();
      for (const candidate of among) {
        watchStyles.observe(candidate, { attributes: true, attributeFilter: ['style'] });
        const { signal } = listening;
        candidate.addEventListener('transitionrun', () => { setSliding(true); }, { signal });
        for (const end of ['transitionend', 'transitioncancel']) {
          candidate.addEventListener(end, () => {
            setSliding(false);
            refresh();
          }, { signal });
        }
      }
      setDocked(bubble ? 'bubble' : 'selection');
      if (bubble) setSettled(key);
      place();
    };
    // It is appended to, or removed from, one of the editor's ancestors.
    const observer = new MutationObserver(refresh);
    for (let parent = view.dom.parentElement; parent; parent = parent.parentElement) {
      observer.observe(parent, { childList: true });
      if (parent === container) break;
    }
    const stop = autoUpdate(reference, element, place);
    refresh();
    return () => {
      observer.disconnect();
      watchStyles.disconnect();
      listening.abort();
      stop();
    };
  }, [view, root, floating, key]);

  return { docked, waiting };
}
