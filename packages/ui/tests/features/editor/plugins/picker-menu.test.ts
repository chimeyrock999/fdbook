// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { floatMenu, placeMenu } from '#features/editor/plugins/picker-menu.ts';

type Rect = { top: number; left: number; width: number; height: number };

// jsdom has no layout: each element gets the box it is given here, also
// as the client and offset sizes floating-ui reads.
function box(element: HTMLElement, rect: Rect) {
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => {
    const { top, left, width, height } = rect;
    return { top, left, width, height, bottom: top + height, right: left + width, x: left, y: top, toJSON: () => rect };
  });
  vi.spyOn(element, 'clientWidth', 'get').mockImplementation(() => rect.width);
  vi.spyOn(element, 'clientHeight', 'get').mockImplementation(() => rect.height);
  vi.spyOn(element, 'offsetWidth', 'get').mockImplementation(() => rect.width);
  vi.spyOn(element, 'offsetHeight', 'get').mockImplementation(() => rect.height);
  return rect;
}

// A 1024x768 window, a note pane that scrolls, a picker at (40, 100) in it
// and its 240x200 menu on the body.
function setup() {
  const pane = document.createElement('div');
  // jsdom computes the longhands only.
  pane.style.overflowY = 'auto';
  const picker = document.createElement('span');
  const button = picker.appendChild(document.createElement('button'));
  const menu = document.createElement('span');
  const options = ['note', 'tip', 'error'].map((name) => {
    const option = menu.appendChild(document.createElement('button'));
    option.textContent = name;
    return option;
  });
  pane.append(picker);
  document.body.append(pane, menu);
  const paneBox = box(pane, { top: 0, left: 0, width: 1024, height: 768 });
  const anchor = box(picker, { top: 100, left: 40, width: 24, height: 24 });
  box(menu, { top: 0, left: 0, width: 240, height: 200 });
  return { pane, paneBox, picker, button, menu, options, anchor };
}

beforeEach(() => {
  // The viewport floating-ui measures is the root element's client box.
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1024);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(768);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('placeMenu', () => {
  it('puts the menu under the picker', async () => {
    const { picker, menu } = setup();
    await placeMenu(menu, picker);
    expect([menu.style.top, menu.style.left, menu.hasAttribute('data-hidden')]).toEqual(['128px', '40px', false]);
  });

  it('puts it over the picker when only that fits, and keeps it inside the window', async () => {
    const { picker, menu, anchor } = setup();
    Object.assign(anchor, { top: 700, left: 1000 });
    await placeMenu(menu, picker);
    expect([menu.style.top, menu.style.left]).toEqual([`${String(700 - 4 - 200)}px`, `${String(1024 - 4 - 240)}px`]);
  });

  it('marks it hidden while the picker is scrolled out of its pane', async () => {
    const { paneBox, picker, menu, anchor } = setup();
    Object.assign(paneBox, { top: 200, height: 568 });
    await placeMenu(menu, picker);
    expect(menu.hasAttribute('data-hidden')).toBe(true);
    Object.assign(anchor, { top: 300 });
    await placeMenu(menu, picker);
    expect(menu.hasAttribute('data-hidden')).toBe(false);
  });
});

describe('floatMenu', () => {
  it('follows the picker when its pane scrolls or the window resizes', async () => {
    const { pane, picker, button, menu, anchor } = setup();
    const stop = floatMenu({ menu, picker, button }, vi.fn());
    await vi.waitFor(() => { expect(menu.style.top).toBe('128px'); });
    Object.assign(anchor, { top: 60 });
    pane.dispatchEvent(new Event('scroll'));
    await vi.waitFor(() => { expect(menu.style.top).toBe('88px'); });
    Object.assign(anchor, { top: 20 });
    window.dispatchEvent(new Event('resize'));
    await vi.waitFor(() => { expect(menu.style.top).toBe('48px'); });
    stop();
    Object.assign(anchor, { top: 300 });
    pane.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(menu.style.top).toBe('48px');
  });

  it('closes on a press outside the picker and the menu, or on Escape back on the button', () => {
    const { picker, button, menu, options } = setup();
    const close = vi.fn();
    const stop = floatMenu({ menu, picker, button }, close);
    // The menu is not inside the picker: a press on it keeps it open.
    options[0]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(close).not.toHaveBeenCalled();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);
    options[1]?.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(close).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(button);
    stop();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('takes Tab from the button into the menu and out of it back to the button', () => {
    const { picker, button, menu, options } = setup();
    const close = vi.fn();
    floatMenu({ menu, picker, button }, close);
    const tab = (shiftKey = false) => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));
    button.focus();
    expect(tab()).toBe(false);
    expect(document.activeElement).toBe(options[0]);
    expect(tab(true)).toBe(false);
    expect(document.activeElement).toBe(button);
    // Between options the browser moves the focus.
    options[1]?.focus();
    expect(tab()).toBe(true);
    options[2]?.focus();
    expect(tab()).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(button);
  });

  it('moves between the options in the two-column grid with the arrow keys, Home and End', () => {
    const { picker, button, menu } = setup();
    // Five options: note tip / error warn / idea.
    const options = [...menu.querySelectorAll('button'), ...['warn', 'idea'].map((name) => {
      const option = menu.appendChild(document.createElement('button'));
      option.textContent = name;
      return option;
    })];
    onTestFinished(floatMenu({ menu, picker, button }, vi.fn()));
    const press = (key: string) => {
      const handled = !document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      return [document.activeElement?.textContent, handled];
    };
    options[0]?.focus();
    expect(press('ArrowRight')).toEqual(['tip', true]);
    expect(press('ArrowDown')).toEqual(['warn', true]);
    // Down from the last row, and Up from the first, stay put.
    expect(press('ArrowDown')).toEqual(['warn', true]);
    expect(press('ArrowLeft')).toEqual(['error', true]);
    expect(press('ArrowDown')).toEqual(['idea', true]);
    // Left and Right wrap around the ends.
    expect(press('ArrowRight')).toEqual(['note', true]);
    expect(press('ArrowUp')).toEqual(['note', true]);
    expect(press('ArrowLeft')).toEqual(['idea', true]);
    expect(press('Home')).toEqual(['note', true]);
    expect(press('End')).toEqual(['idea', true]);
    // Other keys are left alone.
    expect(press('a')).toEqual(['idea', false]);
    // Nor with a modifier: Alt+Left is the browser's Back.
    const back = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true });
    expect(document.activeElement?.dispatchEvent(back)).toBe(true);
    expect(document.activeElement?.textContent).toBe('idea');
  });

  it('takes the arrows from the button to the checked option', () => {
    const { picker, button, menu, options } = setup();
    options[1]?.setAttribute('aria-checked', 'true');
    onTestFinished(floatMenu({ menu, picker, button }, vi.fn()));
    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(options[1]);
    // Keys from elsewhere in the page stay with it.
    const field = document.body.appendChild(document.createElement('input'));
    field.focus();
    expect(field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))).toBe(true);
    expect(document.activeElement).toBe(field);
  });

  it('focuses the checked option, or the first, when opened from the keyboard', () => {
    const { picker, button, menu, options } = setup();
    button.focus();
    const opened = (focus: boolean) => {
      const stop = floatMenu({ menu, picker, button, focus }, vi.fn());
      const active = document.activeElement;
      stop();
      return active;
    };
    // Opened with the mouse: the focus stays.
    expect(opened(false)).toBe(button);
    expect(opened(true)).toBe(options[0]);
    options[2]?.setAttribute('aria-checked', 'true');
    expect(opened(true)).toBe(options[2]);
  });

  it('gives the focus back to the button when the menu goes with the focus in it', () => {
    const { picker, button, menu, options } = setup();
    // Closed with an option focused, before or after the menu is removed.
    let stop = floatMenu({ menu, picker, button, focus: true }, vi.fn());
    stop();
    expect(document.activeElement).toBe(button);
    stop = floatMenu({ menu, picker, button, focus: true }, vi.fn());
    menu.remove();
    stop();
    expect(document.activeElement).toBe(button);
    // The focus went elsewhere first: it stays there.
    document.body.append(menu);
    const field = document.body.appendChild(document.createElement('input'));
    stop = floatMenu({ menu, picker, button }, vi.fn());
    options[1]?.focus();
    field.focus();
    stop();
    expect(document.activeElement).toBe(field);
  });

  it('leaves the focus to a press outside, and hands it back without a scroll', () => {
    const { picker, button, menu } = setup();
    const focus = vi.spyOn(button, 'focus');
    // A press outside closes the menu before the browser moves the focus.
    let stop = floatMenu({ menu, picker, button, focus: true }, () => { stop(); });
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(focus).not.toHaveBeenCalled();
    // The picker may be scrolled out of view: the hand-back does not scroll.
    stop = floatMenu({ menu, picker, button, focus: true }, vi.fn());
    stop();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
