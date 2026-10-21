// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { floatMenu, placeMenu } from '../../../src/plugins/picker-menu';

// jsdom has no layout: each element gets the box it is given here.
function box(element: Element, rect: { top: number; left: number; width: number; height: number }) {
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => {
    const { top, left, width, height } = rect;
    return { top, left, width, height, bottom: top + height, right: left + width, x: left, y: top, toJSON: () => rect };
  });
  return rect;
}

function setup() {
  const pane = document.createElement('div');
  // jsdom computes the longhands only.
  pane.style.overflowY = 'auto';
  const picker = document.createElement('span');
  const menu = document.createElement('span');
  pane.append(picker);
  document.body.append(pane, menu);
  box(pane, { top: 0, left: 0, width: 1024, height: 768 });
  const anchor = box(picker, { top: 100, left: 40, width: 24, height: 24 });
  box(menu, { top: 0, left: 0, width: 240, height: 200 });
  return { pane, picker, menu, anchor };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('placeMenu', () => {
  it('puts the menu under the picker', () => {
    const { picker, menu } = setup();
    placeMenu(menu, picker);
    expect([menu.style.top, menu.style.left, menu.style.visibility]).toEqual(['128px', '40px', '']);
  });

  it('puts it over the picker when only that fits, and keeps it inside the window', () => {
    const { picker, menu, anchor } = setup();
    Object.assign(anchor, { top: 700, left: 1000 });
    placeMenu(menu, picker);
    expect([menu.style.top, menu.style.left]).toEqual([`${String(700 - 4 - 200)}px`, `${String(1024 - 4 - 240)}px`]);
  });

  it('hides it while the picker is scrolled out of its pane', () => {
    const { pane, picker, menu, anchor } = setup();
    box(pane, { top: 200, left: 0, width: 1024, height: 568 });
    placeMenu(menu, picker);
    expect(menu.style.visibility).toBe('hidden');
    Object.assign(anchor, { top: 300 });
    placeMenu(menu, picker);
    expect(menu.style.visibility).toBe('');
  });
});

describe('floatMenu', () => {
  it('follows the picker when a container scrolls or the window resizes', () => {
    const { pane, picker, menu, anchor } = setup();
    const stop = floatMenu(menu, picker, vi.fn());
    expect(menu.style.top).toBe('128px');
    Object.assign(anchor, { top: 60 });
    pane.dispatchEvent(new Event('scroll'));
    expect(menu.style.top).toBe('88px');
    Object.assign(anchor, { top: 20 });
    window.dispatchEvent(new Event('resize'));
    expect(menu.style.top).toBe('48px');
    stop();
    Object.assign(anchor, { top: 300 });
    pane.dispatchEvent(new Event('scroll'));
    expect(menu.style.top).toBe('48px');
  });

  it('closes on a press outside the picker and the menu, or on Escape', () => {
    const { picker, menu } = setup();
    const option = menu.appendChild(document.createElement('button'));
    const close = vi.fn();
    const stop = floatMenu(menu, picker, close);
    // The menu is not inside the picker: a press on it keeps it open.
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    picker.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(close).not.toHaveBeenCalled();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(close.mock.calls).toEqual([['outside'], ['escape']]);
    stop();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(close).toHaveBeenCalledTimes(2);
  });
});
