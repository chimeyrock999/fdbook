import { renderDiagramSvg } from '@site/lib/diagram/render';
import { validateDiagram } from '@site/lib/diagram/validate';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Drawn, Selection } from './DiagramCanvas';
import { addTransition, type Input, type Point } from './edits';

// A connection being drawn from a state's handle, in SVG units.
type Wire = { from: string; start: Point; to: Point };

// A lifecycle drawn by the site's renderer, with a layer on top for editing.
// The layout places every state and route, so nothing is dragged into
// place: click a state or a transition to edit it, and drag from the handle
// on a state's right side to another state (or back onto itself) to add a
// transition.
export function LifecycleCanvas({ doc, readOnly, selection, onSelect, onChange, onDrawn }: {
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
  const [wire, setWire] = useState<Wire | null>(null);
  const overlay = useRef<SVGSVGElement>(null);
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
    if (!wire) return undefined;
    let last = wire;
    const follow = (event: PointerEvent) => {
      last = { ...last, to: at(event) };
      setWire(last);
    };
    const end = (event: PointerEvent) => {
      const [x, y] = at(event);
      const target = current.current?.nodes.find((node) => x >= node.x && x <= node.x + node.width && y >= node.y && y <= node.y + node.height);
      if (target) {
        const made = addTransition(latest.current, last.from, target.id);
        onChange(made.diagram);
        onSelect({ type: 'edge', id: made.id });
      }
      setWire(null);
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
  }, [wire !== null]);

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !scene) return;
    event.currentTarget.focus();
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.studio-dg-panel')) document.activeElement.blur();
    const target = event.target as Element;
    const port = target.closest<SVGElement>('[data-state-port]');
    const edge = target.closest<SVGElement>('[data-hit-edge]');
    const node = target.closest<SVGElement>('[data-node-id]');
    if (port && !readOnly) {
      event.preventDefault();
      const id = port.dataset.statePort ?? '';
      const box = scene.nodes.find((each) => each.id === id);
      if (box) setWire({ from: id, start: [box.x + box.width, box.cy], to: at(event) });
    } else if (edge) onSelect({ type: 'edge', id: edge.dataset.hitEdge ?? '' });
    else if (node) onSelect({ type: 'nodes', ids: [node.dataset.nodeId ?? ''] });
    else onSelect(null);
  };

  if (!scene?.lifecycle || svg === null) {
    const first = drawn.issues.find((issue) => issue.severity === 'error');
    return (
      <div className="studio-dg-canvas dg" data-broken="">
        <p className="studio-dg-problem">{first?.message ?? 'This diagram does not draw.'}{first?.fix ? ` Fix: ${first.fix}.` : ''}</p>
      </div>
    );
  }

  const view = `0 0 ${String(scene.width)} ${String(scene.height)}`;
  const selectedNode = selection?.type === 'nodes' && selection.ids.length === 1 ? scene.nodes.find((each) => each.id === selection.ids[0]) : undefined;
  const selectedEdge = selection?.type === 'edge' ? scene.edges.find((each) => each.edge.id === selection.id) : undefined;

  return (
    <div className="studio-dg-canvas dg" tabIndex={0} aria-label="Lifecycle canvas" data-dragging={wire ? 'connect' : undefined} onPointerDown={down}>
      <div className="dg-canvas" dangerouslySetInnerHTML={{ __html: svg }} />
      <svg ref={overlay} className="studio-dg-overlay" viewBox={view} aria-hidden>
        {scene.edges.map((each) => (
          <path key={each.edge.id} d={each.d} className="studio-dg-hit" data-hit-edge={each.edge.id} data-selected={selectedEdge?.edge.id === each.edge.id || undefined} />
        ))}
        {selectedNode && <rect className="studio-dg-outline" x={selectedNode.x - 3} y={selectedNode.y - 3} width={selectedNode.width + 6} height={selectedNode.height + 6} rx={10} />}
        {!readOnly && scene.nodes.map((node) => (
          <circle key={node.id} className="studio-dg-port" data-state-port={node.id} cx={node.x + node.width} cy={node.cy} r={4.5}>
            <title>Drag to another state to add a transition</title>
          </circle>
        ))}
        {wire && <line className="studio-dg-wire" x1={wire.start[0]} y1={wire.start[1]} x2={wire.to[0]} y2={wire.to[1]} />}
      </svg>
    </div>
  );
}
