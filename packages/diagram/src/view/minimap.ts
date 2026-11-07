// The overview map of the expanded diagram: the whole drawing scaled into a
// corner box, with the part the canvas shows as a frame on it. A transform
// is react-zoom-pan-pinch's: the drawing's origin sits at (x, y) in the
// canvas, at `scale` canvas pixels per drawing unit.

import type { Rect } from '#layout/geometry.ts';

export type Size = {
  width: number;
  height: number;
}

export type Transform = {
  x: number;
  y: number;
  scale: number;
}

export const MINIMAP_MAX: Size = { width: 180, height: 120 };

// Map pixels per drawing unit: the largest that fits the box.
export function minimapScale(drawing: Size, box: Size = MINIMAP_MAX) {
  return Math.min(box.width / drawing.width, box.height / drawing.height);
}

// The part of the drawing the canvas shows, in drawing units.
export function visibleArea({ x, y, scale }: Transform, canvas: Size): Rect {
  return { x: -x / scale, y: -y / scale, width: canvas.width / scale, height: canvas.height / scale };
}

// Whether the canvas already shows the whole drawing, so the map has nothing to add.
export function coversDiagram(transform: Transform, canvas: Size, drawing: Size) {
  const area = visibleArea(transform, canvas);
  const slack = 0.5;
  return area.x <= slack && area.y <= slack
    && area.x + area.width >= drawing.width - slack
    && area.y + area.height >= drawing.height - slack;
}

// The frame on the map, in map pixels: the visible area cut to the drawing.
export function viewportRect(transform: Transform, canvas: Size, drawing: Size, mapScale: number): Rect {
  const area = visibleArea(transform, canvas);
  const left = Math.min(Math.max(area.x, 0), drawing.width);
  const top = Math.min(Math.max(area.y, 0), drawing.height);
  const right = Math.min(Math.max(area.x + area.width, 0), drawing.width);
  const bottom = Math.min(Math.max(area.y + area.height, 0), drawing.height);
  return { x: left * mapScale, y: top * mapScale, width: (right - left) * mapScale, height: (bottom - top) * mapScale };
}

// The transform, at the same scale, that centres the canvas on a drawing point.
export function centerAt(point: { x: number; y: number }, canvas: Size, scale: number): Transform {
  return { x: canvas.width / 2 - point.x * scale, y: canvas.height / 2 - point.y * scale, scale };
}

// Moves the view by a share of the canvas: (0.1, 0) shows what lies a tenth
// of a canvas to the right.
export function panBy(transform: Transform, canvas: Size, dx: number, dy: number): Transform {
  return { ...transform, x: transform.x - dx * canvas.width, y: transform.y - dy * canvas.height };
}
