import { autoUpdate, computePosition, flip, hide, offset, shift } from '@floating-ui/dom';

// The open menu of a picker (the callout type, the accordion kind) lives on
// document.body with position: fixed, placed from the picker's box. Inside
// the note it would paint under the next block: fumadocs-editor makes each
// block its own stacking context (isolation: isolate), so no z-index in the
// block lifts it over its neighbours, and an overflow on the way would clip
// it.

// Space between the picker and its menu, and from the window's edges.
const GAP = 4;

// Under the picker, or over it when only that fits; kept inside the
// window. Marked hidden (picker.css) while the picker is scrolled out of
// its pane.
export async function placeMenu(menu: HTMLElement, picker: Element) {
  const { x, y, middlewareData } = await computePosition(picker, menu, {
    strategy: 'fixed',
    placement: 'bottom-start',
    middleware: [offset(GAP), flip({ padding: GAP }), shift({ padding: GAP }), hide()],
  });
  menu.style.left = `${String(x)}px`;
  menu.style.top = `${String(y)}px`;
  menu.toggleAttribute('data-hidden', middlewareData.hide?.referenceHidden === true);
}

export type FloatingMenu = { menu: HTMLElement; picker: Element; button: HTMLElement };

// Keeps an open `menu` (already on document.body) placed by its `picker`
// while the page scrolls or the layout moves, and calls `close` on a press
// outside both (Safari does not focus a clicked button, so a blur would not
// come) or on Escape, which gives the focus back to `button`. The menu is
// last in the page, so Tab from the button goes into it, and Tab from its
// last option (or Shift+Tab from its first) comes back to the button.
// Returns what undoes it.
export function floatMenu({ menu, picker, button }: FloatingMenu, close: () => void) {
  const outside = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Node && (picker.contains(target) || menu.contains(target)))) close();
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      close();
      button.focus();
      return;
    }
    if (event.key !== 'Tab') return;
    const options = [...menu.querySelectorAll<HTMLElement>('button')];
    const active = document.activeElement;
    if (active === button && !event.shiftKey) {
      event.preventDefault();
      options[0]?.focus();
    } else if (active === options[0] && event.shiftKey) {
      event.preventDefault();
      button.focus();
    } else if (active === options.at(-1) && !event.shiftKey) {
      event.preventDefault();
      close();
      button.focus();
    }
  };
  const stop = autoUpdate(picker, menu, () => { void placeMenu(menu, picker); });
  document.addEventListener('mousedown', outside);
  document.addEventListener('keydown', keys);
  return () => {
    stop();
    document.removeEventListener('mousedown', outside);
    document.removeEventListener('keydown', keys);
  };
}
