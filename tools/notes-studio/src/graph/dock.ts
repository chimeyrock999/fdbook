// Where the graph bar goes next to the editor's own format bubble.
//
// The bubble (@fumadocs-editor/ui 0.5.2) is a tiptap BubbleMenu placed
// "bottom-start" with a 6px offset, so it sits under the selection too, and
// floating-ui flips it above when there is no room below. The editor gives
// no hook to add buttons to it or to find it (fuma-nama/fumadocs-editor,
// drafted as "bubble items"), so the bar finds it by the inline style
// BubbleMenu sets and docks under it.

export type Box = { top: number; bottom: number; left: number; right: number };

const GAP = 6;

// The editor's bubble near `selection`, if it is shown: an element under
// `root` that BubbleMenu positions (absolute, max-content, visible). Of
// several, the one closest to the selection.
export function findBubble(root: Element, selection: Box): Box | null {
  let best: { box: Box; distance: number } | null = null;
  for (const element of root.querySelectorAll<HTMLElement>('[style*="max-content"]')) {
    const { position, visibility, width } = element.style;
    if (position !== 'absolute' || visibility !== 'visible' || width !== 'max-content') continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const distance = rect.top >= selection.bottom ? rect.top - selection.bottom : selection.top - rect.bottom;
    if (distance < 0 || distance > 48) continue;
    if (!best || distance < best.distance) best = { box: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }, distance };
  }
  return best?.box ?? null;
}

// The bar's top-left, `size` being the bar's. Under the bubble when the
// bubble is under the selection, else under the selection. With no room
// left below (the bubble flipped up for the same reason), above the bubble
// or the selection instead. Kept 8px inside the window.
export function placeBar(
  selection: Box,
  bubble: Box | null,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const bubbleUnder = bubble !== null && bubble.top >= selection.bottom;
  const below = bubbleUnder ? bubble : selection;
  const left = Math.max(8, Math.min(below.left, viewport.width - size.width - 8));
  const top = below.bottom + (bubbleUnder ? GAP : 8);
  if (top + size.height <= viewport.height - 8) return { left, top };
  const above = bubble !== null && !bubbleUnder ? bubble : selection;
  return { left, top: Math.max(8, above.top - (above === bubble ? GAP : 8) - size.height) };
}
