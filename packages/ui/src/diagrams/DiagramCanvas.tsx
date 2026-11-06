import { renderDiagramSvg } from '@fdbook/diagram/render.ts';
import type { Scene, SceneEdge } from '@fdbook/diagram/scene.ts';
import type { Side } from '@fdbook/diagram/schema.ts';
import { validateDiagram, type DiagramIssue } from '@fdbook/diagram/validate.ts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { addNodeAt, connectAt, groupNodes, moveNodes, setWaypoints, type Input, type Point } from './edits';

// What is picked on the canvas or in the panel. Cards are not drawn, so
// only the panel picks one.
export type Selection =
  | { type: 'nodes'; ids: string[] }
  | { type: 'edge'; id: string }
  | { type: 'group'; id: string }
  | { type: 'card'; index: number }
  | null;

type Rect = { x: number; y: number; width: number; height: number };

// A gesture under way, from pointerdown to pointerup, in SVG units.
type Drag =
  | { type: 'move'; ids: string[]; from: Point; moved: boolean }
  | { type: 'connect'; node: string; side: Side; from: Point; to: Point }
  | { type: 'waypoint'; edge: string; via: Point[]; index: number; from: Point; moved: boolean };

// What a gesture changes so far.
type Preview = { type: 'move'; ids: string[]; dx: number; dy: number } | { type: 'bend'; edge: string; via: Point[] };

const previewed = (doc: Input, preview: Preview) => (preview.type === 'move'
  ? moveNodes(doc, preview.ids, preview.dx, preview.dy)
  : (doc.edges ?? []).some((edge) => edge.id === preview.edge) ? setWaypoints(doc, preview.edge, preview.via) : doc);

// Pointer travel, in screen pixels, before a press counts as a drag.
const DRAG_PX = 3;
const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

const port = (box: Rect, side: Side): Point => {
  if (side === 'top') return [box.x + box.width / 2, box.y];
  if (side === 'bottom') return [box.x + box.width / 2, box.y + box.height];
  if (side === 'left') return [box.x, box.y + box.height / 2];
  return [box.x + box.width, box.y + box.height / 2];
};

const inside = (box: Rect, [x, y]: Point) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;

// The side of `box` whose middle is nearest `point`.
function nearestSide(box: Rect, [x, y]: Point): Side {
  let best: Side = 'top';
  let distance = Infinity;
  for (const side of SIDES) {
    const [px, py] = port(box, side);
    const here = Math.hypot(px - x, py - y);
    if (here < distance) [best, distance] = [side, here];
  }
  return best;
}

// The node, or else the innermost frame, under `point`.
function endAt(scene: Scene, point: Point): { id: string; box: Rect } | null {
  const node = scene.nodes.find((each) => inside(each, point));
  if (node) return { id: node.node.id, box: node };
  const frames = scene.frames.filter((each) => inside(each, point)).sort((a, b) => a.width * a.height - b.width * b.height);
  return frames[0] ? { id: frames[0].group.id, box: frames[0] } : null;
}

const interior = (edge: SceneEdge): Point[] => edge.points.slice(1, -1).map(([x, y]) => [x, y]);

export type Drawn = { scene: Scene | null; issues: DiagramIssue[] };

// The diagram drawn by the site's renderer, so the canvas shows what the
// note shows, with a layer on top for editing: drag nodes (several with
// Shift) or a frame (its nodes move, the frame follows), drag from a
// selected node's side handle to another node or frame to connect them,
// drag an edge's waypoints or the middle of a segment to bend it (a
// double click removes a waypoint), double click the canvas to add a node.
// Each gesture is one `onChange`; while it lasts the drawing follows.
export function DiagramCanvas({ doc, readOnly, selection, onSelect, onChange, onDrawn }: {
  doc: Input;
  readOnly: boolean;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onChange: (next: Input) => void;
  onDrawn?: (drawn: Drawn) => void;
}) {
  // The gesture under way, drawn on the document as it is now, so a change
  // on disk during a drag shows too.
  const [preview, setPreview] = useState<Preview | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const shown = useMemo(() => (preview ? previewed(doc, preview) : doc), [doc, preview]);
  const drawn = useMemo<Drawn>(() => {
    try {
      const { scene, issues } = validateDiagram(shown);
      return { scene, issues };
    } catch (error) {
      return { scene: null, issues: [{ code: 'render/failed', severity: 'error', message: (error as Error).message }] };
    }
  }, [shown]);
  const { scene } = drawn;
  const svg = useMemo(() => (scene ? renderDiagramSvg(scene, 'studio-editor') : null), [scene]);
  const overlay = useRef<SVGSVGElement>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  // The scene drawn now: an automatic canvas grows while a node is dragged out.
  const current = useRef(scene);
  // The document now: a change on disk can load while a gesture lasts, and
  // the gesture then applies to it, not to the one it started on.
  const latest = useRef(doc);
  useLayoutEffect(() => {
    current.current = scene;
    latest.current = doc;
  });

  // Not while a gesture redraws it: the page around would render every frame.
  useEffect(() => { if (!preview) onDrawn?.(drawn); }, [drawn, preview, onDrawn]);

  // A pointer position in SVG units.
  const at = (event: { clientX: number; clientY: number }): Point => {
    const box = overlay.current?.getBoundingClientRect();
    const drawnNow = current.current;
    if (!drawnNow || !box) return [event.clientX, event.clientY];
    const sx = box.width ? drawnNow.width / box.width : 1;
    const sy = box.height ? drawnNow.height / box.height : 1;
    return [(event.clientX - box.left) * sx, (event.clientY - box.top) * sy];
  };

  // Follows the gesture until the pointer is released, on the window so a
  // drag that leaves the canvas still ends.
  useEffect(() => {
    if (!drag) return undefined;
    let frame = 0;
    let last: Drag = drag;
    const follow = (event: PointerEvent) => {
      const point = at(event);
      const far = press.current !== null && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) >= DRAG_PX;
      if (last.type === 'move') {
        if (!far && !last.moved) return;
        last = { ...last, moved: true };
        const next: Preview = { type: 'move', ids: last.ids, dx: point[0] - last.from[0], dy: point[1] - last.from[1] };
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => { setPreview(next); });
      } else if (last.type === 'connect') {
        last = { ...last, to: point };
        setDrag(last);
      } else {
        const bend = last;
        if (!far && !bend.moved) return;
        const via = bend.via.map((each, index): Point => (index === bend.index ? point : each));
        last = { ...bend, via, moved: true };
        const next: Preview = { type: 'bend', edge: bend.edge, via };
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => { setPreview(next); });
      }
    };
    const end = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      const point = at(event);
      const done = last;
      const now = latest.current;
      const drawnNow = current.current;
      const has = (id: string) => [...now.nodes, ...(now.groups ?? [])].some((item) => item.id === id);
      if (done.type === 'move' && done.moved) onChange(moveNodes(now, done.ids, point[0] - done.from[0], point[1] - done.from[1]));
      else if (done.type === 'waypoint' && done.moved && (now.edges ?? []).some((edge) => edge.id === done.edge)) {
        onChange(setWaypoints(now, done.edge, done.via.map((each, index): Point => (index === done.index ? point : each))));
      } else if (done.type === 'connect' && drawnNow && has(done.node)) {
        const target = endAt(drawnNow, point);
        if (target && target.id !== done.node && has(target.id)) {
          const made = connectAt(now, done.node, target.id, done.side, nearestSide(target.box, point));
          onChange(made.diagram);
          onSelect({ type: 'edge', id: made.id });
        }
      }
      setPreview(null);
      setDrag(null);
      press.current = null;
    };
    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', follow);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    // The gesture reads the document and the scene through refs, so it
    // follows a change on disk; `drag` changes only by its own updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.type]);

  const selectedNodes = selection?.type === 'nodes' ? selection.ids : [];
  const selectedEdge = selection?.type === 'edge' && scene ? scene.edges.find((each) => each.edge.id === selection.id) ?? null : null;

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !scene) return;
    // The canvas takes the focus, so the page's keys act on the selection.
    event.currentTarget.focus();
    // A panel field being edited commits first: the drag below keeps the
    // pointer's default (and so the field's blur) from happening.
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.studio-dg-panel')) document.activeElement.blur();
    const target = event.target as Element;
    const point = at(event);
    press.current = { x: event.clientX, y: event.clientY };
    const portOf = target.closest<SVGElement>('[data-port]');
    const waypoint = target.closest<SVGElement>('[data-waypoint]');
    const insert = target.closest<SVGElement>('[data-insert]');
    const edge = target.closest<SVGElement>('[data-hit-edge]');
    const node = target.closest<SVGElement>('[data-node-id]');
    const group = target.closest<SVGElement>('[data-group-id]');
    if (portOf && !readOnly && selectedNodes.length === 1) {
      event.preventDefault();
      const box = scene.nodes.find((each) => each.node.id === selectedNodes[0]);
      if (box) setDrag({ type: 'connect', node: selectedNodes[0], side: portOf.dataset.port as Side, from: port(box, portOf.dataset.port as Side), to: point });
    } else if ((waypoint || insert) && selectedEdge && !readOnly) {
      event.preventDefault();
      const via = interior(selectedEdge);
      const index = Number(waypoint ? waypoint.dataset.waypoint : insert?.dataset.insert);
      // The middle of segment `index` puts a new waypoint there.
      if (insert) via.splice(index, 0, point);
      setDrag({ type: 'waypoint', edge: selectedEdge.edge.id, via, index, from: point, moved: false });
    } else if (edge) {
      onSelect({ type: 'edge', id: edge.dataset.hitEdge ?? '' });
    } else if (node) {
      const id = node.dataset.nodeId ?? '';
      const ids = event.shiftKey
        ? (selectedNodes.includes(id) ? selectedNodes.filter((each) => each !== id) : [...selectedNodes, id])
        : selectedNodes.includes(id) ? selectedNodes : [id];
      onSelect(ids.length ? { type: 'nodes', ids } : null);
      if (!readOnly && ids.includes(id)) {
        event.preventDefault();
        setDrag({ type: 'move', ids, from: point, moved: false });
      }
    } else if (group) {
      const id = group.dataset.groupId ?? '';
      onSelect({ type: 'group', id });
      if (!readOnly) {
        event.preventDefault();
        setDrag({ type: 'move', ids: groupNodes(doc, id), from: point, moved: false });
      }
    } else onSelect(null);
  };

  const doubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (readOnly || !scene) return;
    const target = event.target as Element;
    const waypoint = target.closest<SVGElement>('[data-waypoint]');
    if (waypoint && selectedEdge) {
      const via = interior(selectedEdge).filter((_, index) => index !== Number(waypoint.dataset.waypoint));
      onChange(setWaypoints(doc, selectedEdge.edge.id, via));
      return;
    }
    if (target.closest('[data-node-id], [data-group-id], [data-hit-edge], [data-port], [data-insert]')) return;
    const [x, y] = at(event);
    const made = addNodeAt(doc, { x: x - 80, y: y - 32 });
    onChange(made.diagram);
    onSelect({ type: 'nodes', ids: [made.id] });
  };

  if (!scene || svg === null) {
    const first = drawn.issues.find((issue) => issue.severity === 'error');
    return (
      <div className="studio-dg-canvas dg" data-broken="">
        <p className="studio-dg-problem">{first?.message ?? 'This diagram does not draw.'}{first?.fix ? ` Fix: ${first.fix}.` : ''}</p>
      </div>
    );
  }

  const nodeBox = (id: string) => scene.nodes.find((each) => each.node.id === id);
  const frame = selection?.type === 'group' ? scene.frames.find((each) => each.group.id === selection.id) : undefined;
  const single = selectedNodes.length === 1 && !readOnly ? nodeBox(selectedNodes[0]) : undefined;
  const view = `0 0 ${String(scene.width)} ${String(scene.height)}`;

  return (
    <div
      className="studio-dg-canvas dg"
      tabIndex={0}
      aria-label="Diagram canvas"
      data-dragging={drag ? drag.type : undefined}
      onPointerDown={down}
      onDoubleClick={doubleClick}
    >
      <div className="dg-canvas" dangerouslySetInnerHTML={{ __html: svg }} />
      <svg ref={overlay} className="studio-dg-overlay" viewBox={view} aria-hidden>
        {scene.edges.map((each) => (
          <path key={each.edge.id} d={each.d} className="studio-dg-hit" data-hit-edge={each.edge.id} data-selected={selectedEdge?.edge.id === each.edge.id || undefined} />
        ))}
        {selectedNodes.map((id) => {
          const box = nodeBox(id);
          return box ? <rect key={id} className="studio-dg-outline" x={box.x - 3} y={box.y - 3} width={box.width + 6} height={box.height + 6} rx={10} /> : null;
        })}
        {frame && <rect className="studio-dg-outline" x={frame.x - 3} y={frame.y - 3} width={frame.width + 6} height={frame.height + 6} rx={frame.radius + 3} />}
        {single && SIDES.map((side) => {
          const [x, y] = port(single, side);
          return <circle key={side} className="studio-dg-port" data-port={side} cx={x} cy={y} r={5}><title>Drag to connect</title></circle>;
        })}
        {selectedEdge && !readOnly && (
          <>
            {selectedEdge.points.slice(0, -1).map(([x, y], index) => {
              const [nx, ny] = selectedEdge.points[index + 1];
              return <rect key={`insert-${String(index)}`} className="studio-dg-insert" data-insert={index} x={(x + nx) / 2 - 3} y={(y + ny) / 2 - 3} width={6} height={6}><title>Drag to bend</title></rect>;
            })}
            {interior(selectedEdge).map(([x, y], index) => (
              <circle key={`waypoint-${String(index)}`} className="studio-dg-waypoint" data-waypoint={index} cx={x} cy={y} r={4.5}><title>Drag to move, double click to remove</title></circle>
            ))}
          </>
        )}
        {drag?.type === 'connect' && <line className="studio-dg-wire" x1={drag.from[0]} y1={drag.from[1]} x2={drag.to[0]} y2={drag.to[1]} />}
      </svg>
    </div>
  );
}
