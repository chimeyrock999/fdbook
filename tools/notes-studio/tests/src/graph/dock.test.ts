// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { findBubble, placeBar, type Box } from '../../../src/graph/dock';

const selection: Box = { top: 440, bottom: 465, left: 468, right: 760 };
const bar = { width: 380, height: 35 };
const screen = { width: 1280, height: 820 };
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// An element styled the way tiptap's BubbleMenu styles its bubble.
function bubbleAt(box: Box, style = 'visibility: visible; position: absolute; opacity: 1; width: max-content; left: 24px; top: 600px;') {
  const element = document.createElement('div');
  element.setAttribute('style', style);
  element.getBoundingClientRect = () => ({ ...box, width: box.right - box.left, height: box.bottom - box.top, x: box.left, y: box.top, toJSON: () => box });
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('graph bar placement', () => {
  it('docks under the bubble when the bubble is under the selection', () => {
    // As measured in Chromium (#55): the bubble 6px under the selection, 352×38.
    const bubble: Box = { top: 471, bottom: 509, left: 468, right: 820 };
    bubbleAt(bubble);
    const found = findBubble(document.body, selection);
    expect(found).toEqual(bubble);
    const place = placeBar(selection, found, bar, screen);
    expect(place).toEqual({ top: 515, left: 468 });
    expect(overlaps({ top: place.top, bottom: place.top + 35, left: place.left, right: place.left + 380 }, bubble)).toBe(false);
  });

  it('stays under the selection when the bubble flipped above it, or is not shown', () => {
    const above: Box = { top: 396, bottom: 434, left: 468, right: 820 };
    bubbleAt(above);
    const place = placeBar(selection, findBubble(document.body, selection), bar, screen);
    expect(place).toEqual({ top: 473, left: 468 });
    expect(overlaps({ top: place.top, bottom: place.top + 35, left: place.left, right: place.left + 380 }, above)).toBe(false);
    expect(placeBar(selection, null, bar, screen)).toEqual({ top: 473, left: 468 });
  });

  it('ignores hidden bubbles, other positioned elements and far ones', () => {
    bubbleAt({ top: 471, bottom: 509, left: 468, right: 820 }, 'visibility: hidden; position: absolute; width: max-content;');
    bubbleAt({ top: 471, bottom: 509, left: 468, right: 820 }, 'position: absolute; width: 200px; visibility: visible;');
    bubbleAt({ top: 700, bottom: 738, left: 468, right: 820 });
    expect(findBubble(document.body, selection)).toBeNull();
  });

  it('goes above when there is no room below', () => {
    // As measured near the bottom of an 820px window: the bubble flipped up.
    const low: Box = { top: 770, bottom: 795, left: 348, right: 640 };
    const flipped: Box = { top: 729, bottom: 767, left: 348, right: 700 };
    const place = placeBar(low, flipped, bar, screen);
    expect(place).toEqual({ top: 729 - 6 - 35, left: 348 });
    const box = { top: place.top, bottom: place.top + 35, left: place.left, right: place.left + 380 };
    expect(overlaps(box, flipped) || overlaps(box, low)).toBe(false);
    // No bubble: above the selection.
    expect(placeBar(low, null, bar, screen).top).toBe(770 - 8 - 35);
  });

  it('keeps the bar on screen', () => {
    expect(placeBar({ ...selection, left: 1200, right: 1260 }, null, bar, screen).left).toBe(1280 - 380 - 8);
    expect(placeBar({ ...selection, left: -20, right: 40 }, null, bar, screen).left).toBe(8);
  });
});
