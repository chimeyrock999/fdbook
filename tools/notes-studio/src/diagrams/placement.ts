import type { Scene } from '@site/lib/diagram/scene';
import { freeSpot, groupNodes, roomFor, type Input, type Place } from './edits';

type Rect = { x: number; y: number; width: number; height: number };

// What a grown canvas keeps under a copy placed below the drawing.
const MARGIN = 40;
const LEGEND_ROOM = 96;

// The band the legend takes at the bottom of the drawing.
export const legendBand = (scene: Scene): Rect => ({ x: 0, y: scene.height - 72, width: scene.width, height: 72 });

const area = (rect: Rect) => rect.width * rect.height;

function boundsOf(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return { x, y, width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x, height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y };
}

// Where a copy of the nodes `ids`, or of the frame `group`, goes so that the
// drawing keeps no new overlap: inside the innermost frame that holds all
// of them when it has room (the copy then joins the frames that list them),
// else in the first free spot of the drawing (joining no frame), else below
// it.
export function placeCopy(doc: Input, scene: Scene, copied: { nodes: readonly string[] } | { group: string }): Place {
  const nodes = 'group' in copied ? groupNodes(doc, copied.group) : copied.nodes;
  const own = 'group' in copied ? scene.frames.find((frame) => frame.group.id === copied.group) : undefined;
  const boxes = scene.nodes.filter((node) => nodes.includes(node.node.id));
  if (!boxes.length) return { dx: 0, dy: 0, join: [] };
  const box = own ?? boundsOf(boxes);
  const size = { w: box.width, h: box.height };
  // Frames that hold every copied node, the copied frame and those inside it aside.
  const inside = (id: string) => 'group' in copied && (id === copied.group || groupNodes(doc, id).every((node) => nodes.includes(node)));
  const holders = scene.frames.filter((frame) => !inside(frame.group.id) && nodes.every((node) => groupNodes(doc, frame.group.id).includes(node)));
  const container = [...holders].sort((a, b) => area(a) - area(b)).at(0);
  const legend = scene.legend ? [legendBand(scene)] : [];
  if (container) {
    const taken = [...scene.nodes, ...scene.frames.filter((frame) => !holders.includes(frame)), ...legend];
    // Within the box its nodes span now, so the frame, drawn around them, does not grow.
    const members = groupNodes(doc, container.group.id);
    const bounds = boundsOf(scene.nodes.filter((node) => members.includes(node.node.id)));
    const spot = roomFor(taken, bounds, size);
    if (spot) {
      const listing = (members: readonly string[]) => members.some((member) => nodes.includes(member) || ('group' in copied && member === copied.group));
      const join = holders.filter((frame) => frame === container || listing(frame.group.members)).map((frame) => frame.group.id);
      return { dx: spot.x - box.x, dy: spot.y - box.y, join };
    }
  }
  const spot = freeSpot([...scene.nodes, ...scene.frames, ...legend], scene.width, scene.height, size);
  // Below the drawing, a fixed canvas grows to hold the copy, the legend under it.
  const bottom = spot.y + size.h + (legend.length ? LEGEND_ROOM : MARGIN);
  return { dx: spot.x - box.x, dy: spot.y - box.y, join: [], ...(doc.layout.canvas && bottom > scene.height ? { height: Math.ceil(bottom) } : {}) };
}
