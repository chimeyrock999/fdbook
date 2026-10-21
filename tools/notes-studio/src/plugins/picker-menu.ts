// The open menu of a picker (the callout type, the accordion kind) lives on
// document.body with position: fixed, placed from the picker's box. Inside
// the note it would paint under the next block: fumadocs-editor makes each
// block its own stacking context (isolation: isolate), so no z-index in the
// block lifts it over its neighbours, and an overflow on the way would clip
// it.

// Space between the picker and its menu, and from the window's edges.
const GAP = 4;

// The boxes `element` is clipped to: every ancestor that does not let its
// content overflow, as one rectangle.
function clipBox(element: Element) {
  let top = 0;
  let left = 0;
  let bottom = window.innerHeight;
  let right = window.innerWidth;
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if ([overflowX, overflowY].every((overflow) => overflow === '' || overflow === 'visible')) continue;
    const box = node.getBoundingClientRect();
    top = Math.max(top, box.top);
    left = Math.max(left, box.left);
    bottom = Math.min(bottom, box.bottom);
    right = Math.min(right, box.right);
  }
  return { top, left, bottom, right };
}

// Under the picker, or over it when only that fits; kept inside the
// window. Hidden while the picker is scrolled out of sight.
export function placeMenu(menu: HTMLElement, picker: Element) {
  const anchor = picker.getBoundingClientRect();
  const clip = clipBox(picker);
  const seen = anchor.bottom >= clip.top && anchor.top <= clip.bottom && anchor.right >= clip.left && anchor.left <= clip.right;
  menu.style.visibility = seen ? '' : 'hidden';
  const { width, height } = menu.getBoundingClientRect();
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - height;
  const top = below + height > window.innerHeight - GAP && above >= GAP ? above : below;
  const left = Math.max(GAP, Math.min(anchor.left, window.innerWidth - GAP - width));
  menu.style.top = `${String(top)}px`;
  menu.style.left = `${String(left)}px`;
}

export type CloseReason = 'outside' | 'escape';

// Keeps an open `menu` (already on document.body) placed by its `picker`
// while the page scrolls or resizes, and calls `close` on a press outside
// both (Safari does not focus a clicked button, so a blur would not come)
// or on Escape. Returns what undoes it.
export function floatMenu(menu: HTMLElement, picker: Element, close: (reason: CloseReason) => void) {
  const place = () => { placeMenu(menu, picker); };
  const outside = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Node && (picker.contains(target) || menu.contains(target)))) close('outside');
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close('escape');
  };
  place();
  // Capture: a scroll of any container (the note pane) does not bubble.
  document.addEventListener('scroll', place, { capture: true, passive: true });
  window.addEventListener('resize', place);
  document.addEventListener('mousedown', outside);
  document.addEventListener('keydown', escape);
  return () => {
    document.removeEventListener('scroll', place, { capture: true });
    window.removeEventListener('resize', place);
    document.removeEventListener('mousedown', outside);
    document.removeEventListener('keydown', escape);
  };
}
