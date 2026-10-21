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

export type FloatingMenu = { menu: HTMLElement; picker: Element; button: HTMLElement; focus?: boolean };

// The menu's columns, as picker.css lays them out.
const COLUMNS = 2;

// Where an arrow key, Home or End takes the focus from the option at
// `index` of `count`: Left and Right go through the options in reading
// order and wrap around the ends, Up and Down stay in the column and stop
// at its ends.
function step(key: string, index: number, count: number) {
  switch (key) {
    case 'ArrowRight': return (index + 1) % count;
    case 'ArrowLeft': return (index - 1 + count) % count;
    case 'ArrowDown': return index + COLUMNS < count ? index + COLUMNS : index;
    case 'ArrowUp': return index - COLUMNS >= 0 ? index - COLUMNS : index;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

// Keeps an open `menu` (already on document.body) placed by its `picker`
// while the page scrolls or the layout moves, and calls `close` on a press
// outside both (Safari does not focus a clicked button, so a blur would not
// come) or on Escape, which gives the focus back to `button`. The menu is
// last in the page, so Tab from the button goes into it, and Tab from its
// last option (or Shift+Tab from its first) comes back to the button. The
// arrow keys, Home and End move between the options (see `step`), and Up
// or Down from the button goes to the checked option, where the focus also
// starts when `focus` is set (the menu was opened from the keyboard).
// Returns what undoes it, which also gives the focus back to the button
// when it was in the menu (a pick closes the menu under the option), but
// not after a press outside, which moves the focus itself.
export function floatMenu({ menu, picker, button, focus = false }: FloatingMenu, close: () => void) {
  const options = () => [...menu.querySelectorAll<HTMLElement>('button')];
  const checked = () => menu.querySelector<HTMLElement>('button[aria-checked="true"]') ?? options().at(0);
  // Whether the focus is in the menu. A removed option takes the focus to
  // the body with no element to go to, so only a move to another element
  // takes it out.
  let inside = false;
  let pressed = false;
  const focusin = () => { inside = true; };
  const focusout = (event: FocusEvent) => {
    const to = event.relatedTarget;
    if (to instanceof Node) inside = menu.contains(to);
  };
  const outside = (event: Event) => {
    const target = event.target;
    if (target instanceof Node && (picker.contains(target) || menu.contains(target))) return;
    // The press moves the focus itself.
    pressed = true;
    close();
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      close();
      button.focus();
      return;
    }
    const all = options();
    const active = document.activeElement;
    if (event.key !== 'Tab') {
      // Alt+Left and the like stay the browser's.
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const index = all.findIndex((option) => option === active);
      const next = index >= 0 ? step(event.key, index, all.length) : null;
      if (next !== null) {
        event.preventDefault();
        all[next]?.focus();
      } else if (active === button && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        checked()?.focus();
      }
      return;
    }
    if (active === button && !event.shiftKey) {
      event.preventDefault();
      all[0]?.focus();
    } else if (active === all[0] && event.shiftKey) {
      event.preventDefault();
      button.focus();
    } else if (active === all.at(-1) && !event.shiftKey) {
      event.preventDefault();
      close();
      button.focus();
    }
  };
  const stop = autoUpdate(picker, menu, () => { void placeMenu(menu, picker); });
  document.addEventListener('mousedown', outside);
  document.addEventListener('keydown', keys);
  menu.addEventListener('focusin', focusin);
  menu.addEventListener('focusout', focusout);
  // Not placed yet: the page must not scroll to where the menu starts.
  if (focus) checked()?.focus({ preventScroll: true });
  return () => {
    stop();
    document.removeEventListener('mousedown', outside);
    document.removeEventListener('keydown', keys);
    menu.removeEventListener('focusin', focusin);
    menu.removeEventListener('focusout', focusout);
    const active = document.activeElement;
    // The picker may be scrolled out of view.
    if (!pressed && (menu.contains(active) || (inside && (active === null || active === document.body)))) button.focus({ preventScroll: true });
  };
}
