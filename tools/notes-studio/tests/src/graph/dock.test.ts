// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { anchorRect } from '../../../src/graph/dock';

const box = (left: number, top: number, right: number, bottom: number) => new DOMRect(left, top, right - left, bottom - top);
const edges = (rect: DOMRect) => [rect.left, rect.top, rect.right, rect.bottom];

// The popups go below this box (above it with no room below).
describe('graph popup anchor', () => {
  const selection = box(468, 440, 760, 465);

  it('reaches down to the bubble when the bubble is under the selection', () => {
    // As measured in Chromium (#55): the bubble 6px under the selection, 352×38.
    expect(edges(anchorRect(selection, box(468, 471, 820, 509)))).toEqual([468, 440, 820, 509]);
  });

  it('ends at the selection when the bubble flipped above it', () => {
    expect(edges(anchorRect(selection, box(468, 396, 820, 434)))).toEqual([468, 396, 820, 465]);
  });

  it('is the selection without a bubble', () => {
    expect(anchorRect(selection, null)).toBe(selection);
  });
});
