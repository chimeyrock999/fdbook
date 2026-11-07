import { autoUpdate, computePosition, flip, hide, offset, shift } from '@floating-ui/dom';
import { useLayoutEffect, type RefObject } from 'react';

const GAP = 6;

// Keeps `floating` (fixed, on document.body: a block of the note is its
// own stacking context and would paint the next block over it) under its
// mark in the margin,
// or over it with no room below, and hidden while the mark is scrolled
// away. Calls `close` on a press outside both, or on Escape.
export function useFloatBy(anchor: HTMLElement | null, floating: RefObject<HTMLElement | null>, close: () => void) {
  useLayoutEffect(() => {
    const element = floating.current;
    if (anchor === null || element === null) return undefined;
    const place = () => {
      void computePosition(anchor, element, { strategy: 'fixed', placement: 'bottom-end', middleware: [offset(GAP), flip({ padding: 8 }), shift({ padding: 8 }), hide()] }).then(({ x, y, middlewareData }) => {
        element.style.left = `${String(x)}px`;
        element.style.top = `${String(y)}px`;
        element.toggleAttribute('data-hidden', middlewareData.hide?.referenceHidden === true);
      });
    };
    const stop = autoUpdate(anchor, element, place);
    const onPress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!element.contains(target) && !anchor.contains(target)) close();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.isComposing) close(); };
    document.addEventListener('pointerdown', onPress, true);
    document.addEventListener('keydown', onKey);
    return () => {
      stop();
      document.removeEventListener('pointerdown', onPress, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor, floating, close]);
}
