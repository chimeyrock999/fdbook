// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { floatMenu, placeMenu } from '../../../src/plugins/picker-menu';

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
});
