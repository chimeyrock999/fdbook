import { renderDiagramSvg } from '@fdbook/diagram/render.ts';
import type { SequenceLayer } from '@fdbook/diagram/sequence.ts';
import { validateDiagram } from '@fdbook/diagram/validate.ts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Drawn, Selection } from './DiagramCanvas';
import { addMessage, messageIndexAt, moveMessage, moveParticipant, participantIndexAt, type Input, type Point } from './edits';

// A gesture under way, from pointerdown to pointerup, in SVG units.
type Drag =
  | { type: 'column'; id: string; from: Point; to: Point; moved: boolean }
  | { type: 'message'; id: string; to: Point }
  | { type: 'connect'; node: string; from: Point; to: Point };

// Pointer travel, in screen pixels, before a press counts as a drag.
const DRAG_PX = 3;
// The grip a message is dragged by, in the left margin of the timeline.
const GRIP = { x: 6, width: 12, height: 18 };

// A sequence drawn by the site's renderer, with a layer on top for editing:
// drag a participant's header sideways to change its column, drag a
// message's grip up or down to move it in the timeline, drag from the
// handle under a lifeline to another lifeline to add a message there.
// Nothing has a position to drag: the order lays the drawing out.
export function SequenceCanvas({ doc, readOnly, selection, onSelect, onChange, onDrawn }: {
  doc: Input;
  readOnly: boolean;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onChange: (next: Input) => void;
  onDrawn?: (drawn: Drawn) => void;
}) {
  const drawn = useMemo<Drawn>(() => {
    try {
      const { scene, issues } = validateDiagram(doc);
      return { scene, issues };
    } catch (error) {
      return { scene: null, issues: [{ code: 'render/failed', severity: 'error', message: (error as Error).message }] };
    }
  }, [doc]);
  const { scene } = drawn;
  const svg = useMemo(() => (scene ? renderDiagramSvg(scene, 'studio-editor') : null), [scene]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const current = useRef(scene);
  const latest = useRef(doc);
  useLayoutEffect(() => {
    current.current = scene;
    latest.current = doc;
  });
  useEffect(() => { onDrawn?.(drawn); }, [drawn, onDrawn]);

  const at = (event: { clientX: number; clientY: number }): Point => {
    const box = overlay.current?.getBoundingClientRect();
    const drawnNow = current.current;
    if (!drawnNow || !box) return [event.clientX, event.clientY];
    return [(event.clientX - box.left) * (box.width ? drawnNow.width / box.width : 1), (event.clientY - box.top) * (box.height ? drawnNow.height / box.height : 1)];
  };

  useEffect(() => {
    if (!drag) return undefined;
    let last: Drag = drag;
    const follow = (event: PointerEvent) => {
      const point = at(event);
      const far = press.current !== null && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) >= DRAG_PX;
      if (last.type === 'column') {
        if (!far && !last.moved) return;
        last = { ...last, to: point, moved: true };
      } else last = { ...last, to: point };
      setDrag(last);
    };
    const end = (event: PointerEvent) => {
      const point = at(event);
      const done = last;
      const now = latest.current;
      const layer = current.current?.sequence;
      if (layer && done.type === 'column' && done.moved) {
        // Dropped back in its own column, nothing changes, so no undo step.
        const index = participantIndexAt(layer, done.id, point[0]);
        if (index !== now.nodes.findIndex((node) => node.id === done.id)) onChange(moveParticipant(now, done.id, index));
      }
      else if (layer && done.type === 'message') {
        const index = messageIndexAt(layer, done.id, point[1]);
        if (index !== null) onChange(moveMessage(now, done.id, index));
      } else if (layer && done.type === 'connect') {
        const target = lifelineAt(layer, point[0], layer.participantWidth / 2);
        if (target && target !== done.node) {
          const made = addMessage(now, layer, done.node, target, point[1]);
          onChange(made.diagram);
          onSelect({ type: 'edge', id: made.id });
        }
      }
      setDrag(null);
      press.current = null;
    };
    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', follow);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    // The gesture reads the document and the scene through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.type]);

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    const layer = scene?.sequence;
    if (event.button !== 0 || !layer) return;
    event.currentTarget.focus();
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.studio-dg-panel')) document.activeElement.blur();
    const target = event.target as Element;
    const point = at(event);
    press.current = { x: event.clientX, y: event.clientY };
    const grip = target.closest<SVGElement>('[data-grip]');
    const lifeline = target.closest<SVGElement>('[data-lifeline-port]');
    const edge = target.closest<SVGElement>('[data-hit-edge]');
    const node = target.closest<SVGElement>('[data-node-id]');
    if (grip && !readOnly) {
      event.preventDefault();
      const id = grip.dataset.grip ?? '';
      onSelect({ type: 'edge', id });
      setDrag({ type: 'message', id, to: point });
    } else if (lifeline && !readOnly) {
      event.preventDefault();
      const id = lifeline.dataset.lifelinePort ?? '';
      const x = layer.columns[id];
      setDrag({ type: 'connect', node: id, from: [x, point[1]], to: point });
    } else if (edge) onSelect({ type: 'edge', id: edge.dataset.hitEdge ?? '' });
    else if (node) {
      const id = node.dataset.nodeId ?? '';
      onSelect({ type: 'nodes', ids: [id] });
      if (!readOnly) {
        event.preventDefault();
        setDrag({ type: 'column', id, from: point, to: point, moved: false });
      }
    } else onSelect(null);
  };

  if (!scene?.sequence || svg === null) {
    const first = drawn.issues.find((issue) => issue.severity === 'error');
    return (
      <div className="studio-dg-canvas dg" data-broken="">
        <p className="studio-dg-problem">{first?.message ?? 'This diagram does not draw.'}{first?.fix ? ` Fix: ${first.fix}.` : ''}</p>
      </div>
    );
  }

  const layer = scene.sequence;
  const view = `0 0 ${String(scene.width)} ${String(scene.height)}`;
  const selectedNode = selection?.type === 'nodes' && selection.ids.length === 1 ? scene.nodes.find((each) => each.id === selection.ids[0]) : undefined;
  const selectedEdge = selection?.type === 'edge' ? layer.messages.find((message) => message.edge.id === selection.id) : undefined;
  const dragged = drag?.type === 'column' && drag.moved ? drag : null;
  const dropY = drag?.type === 'message' ? dropLine(layer, drag.id, drag.to[1]) : null;

  return (
    <div className="studio-dg-canvas dg" tabIndex={0} aria-label="Sequence canvas" data-dragging={drag ? drag.type : undefined} onPointerDown={down}>
      <div className="dg-canvas" dangerouslySetInnerHTML={{ __html: svg }} />
      <svg ref={overlay} className="studio-dg-overlay" viewBox={view} aria-hidden>
        {layer.messages.map((message) => (
          <path key={message.edge.id} d={`M${String(message.start)} ${String(message.y)}H${String(message.end)}`} className="studio-dg-hit" data-hit-edge={message.edge.id} data-selected={selectedEdge?.edge.id === message.edge.id || undefined} />
        ))}
        {selectedEdge && (
          <rect className="studio-dg-outline" x={Math.min(selectedEdge.start, selectedEdge.end) - 6} y={selectedEdge.y - 22} width={Math.abs(selectedEdge.end - selectedEdge.start) + 12} height={(selectedEdge.note ? selectedEdge.note.y + selectedEdge.note.height : selectedEdge.y + 6) - selectedEdge.y + 26} rx={6} />
        )}
        {selectedNode && <rect className="studio-dg-outline" x={selectedNode.x - 3} y={selectedNode.y - 3} width={selectedNode.width + 6} height={selectedNode.height + 6} rx={10} />}
        {dragged && (
          <rect className="studio-dg-outline studio-dg-ghost" x={(scene.nodes.find((each) => each.id === dragged.id)?.x ?? 0) + dragged.to[0] - dragged.from[0]} y={layer.lifelines[0].top - 70} width={layer.participantWidth} height={60} rx={8} />
        )}
        {!readOnly && layer.messages.map((message) => (
          <g key={message.edge.id} className="studio-dg-grip" data-grip={message.edge.id}>
            <title>Drag to move it in the timeline</title>
            <rect x={GRIP.x} y={message.y - GRIP.height / 2} width={GRIP.width} height={GRIP.height} rx={3} />
            {[-4, 0, 4].map((dy) => <circle key={dy} cx={GRIP.x + GRIP.width / 2} cy={message.y + dy} r={1} />)}
          </g>
        ))}
        {!readOnly && layer.lifelines.map((line) => (
          <circle key={line.node} className="studio-dg-port" data-lifeline-port={line.node} cx={line.x} cy={line.bottom} r={5}>
            <title>Drag to another lifeline to add a message</title>
          </circle>
        ))}
        {dropY !== null && <line className="studio-dg-drop" x1={24} x2={scene.width - 24} y1={dropY} y2={dropY} />}
        {drag?.type === 'connect' && <line className="studio-dg-wire" x1={drag.from[0]} y1={drag.from[1]} x2={drag.to[0]} y2={drag.to[1]} />}
      </svg>
    </div>
  );
}

// The participant whose lifeline is within `reach` of `x`.
function lifelineAt(layer: SequenceLayer, x: number, reach: number) {
  return layer.lifelines.find((line) => Math.abs(line.x - x) <= reach)?.node ?? null;
}

// Where a dragged message would land, as a line between two messages.
function dropLine(layer: SequenceLayer, id: string, y: number) {
  const index = messageIndexAt(layer, id, y);
  if (index === null) return null;
  const others = layer.messages.filter((message) => message.edge.id !== id);
  if (!others.length) return null;
  if (index === 0) return others[0].y - 24;
  if (index >= others.length) return others[others.length - 1].y + 24;
  return (others[index - 1].y + others[index].y) / 2;
}
