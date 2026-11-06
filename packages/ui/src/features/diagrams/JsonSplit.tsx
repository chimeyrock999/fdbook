import type { KeyboardEvent, PointerEvent } from 'react';
import { SPLIT_MIN } from './useJsonHeight';

const STEP = 24;

// The bar between the drawing and the JSON: drag it, or use the arrow keys
// on it; a double click goes back to halves. `column` is the element that
// holds both, whose height bounds the drag.
export function JsonSplit({ height, onResize, column }: { height: number | null; onResize: (height: number | null) => void; column: () => HTMLElement | null }) {
  const bounds = () => {
    const box = column()?.getBoundingClientRect();
    return { bottom: box?.bottom ?? 0, max: Math.max(SPLIT_MIN, (box?.height ?? 0) - SPLIT_MIN) };
  };
  const fit = (value: number, max: number) => Math.min(Math.max(value, SPLIT_MIN), max);

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const { bottom, max } = bounds();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    handle.dataset.dragging = '';
    const move = (next: globalThis.PointerEvent) => { onResize(fit(bottom - next.clientY, max)); };
    const stop = () => {
      delete handle.dataset.dragging;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };

  const byKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const { max } = bounds();
    const now = height ?? max / 2;
    const step = event.shiftKey ? STEP * 4 : STEP;
    const next = { ArrowUp: now + step, ArrowDown: now - step, Home: max, End: SPLIT_MIN }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onResize(fit(next, max));
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the JSON"
      aria-valuemin={SPLIT_MIN}
      aria-valuenow={height === null ? undefined : Math.round(height)}
      tabIndex={0}
      title="Drag to resize, double-click for halves"
      className="studio-dg-split"
      onPointerDown={start}
      onDoubleClick={() => { onResize(null); }}
      onKeyDown={byKey}
    />
  );
}
