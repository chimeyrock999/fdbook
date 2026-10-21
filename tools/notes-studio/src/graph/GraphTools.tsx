import type { EditorView } from '@tiptap/pm/view';
import { Highlighter, PencilLine, Sprout, Tag } from 'lucide-react';
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useEditorPlugin } from '../editor/decorations';
import { composing } from '../keyboard';
import { useDock } from './dock';
import { closeGraphFields, graphCommand, graphKey, graphPlugin, type GraphAction } from './graph-plugin';
import { defaults, graphMetaTarget, markerAt, updateMarker, wrapRange, type Marker } from './markers';

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

function shortcut(key: string) {
  return MAC ? `⌘⌥${key}` : `Ctrl+Alt+${key}`;
}

const LABELS: Record<Marker['kind'], string> = { Keyword: 'Keyword', Tag: 'Tag', GraphMeta: 'Graph node' };

// The graph bar (wrap the selection as a Keyword or Tag, mark the heading
// as a graph node, edit the marker there) and the fields of a marker's id
// and displayName. The bar docks under the editor's own format bubble when
// that sits under the selection (see dock.ts). Both live on the live editor
// inside `container`, through the graph plugin.
export function GraphTools({ container }: { container: RefObject<HTMLElement | null> }) {
  const [view, setView] = useState<EditorView | null>(null);
  const [, redraw] = useState(0);
  const plugin = useMemo(() => graphPlugin((next) => {
    setView(next);
    redraw((count) => count + 1);
  }), []);
  useEditorPlugin(container, plugin);
  // The bar shows only while the editor has the focus.
  useEffect(() => {
    const again = () => { redraw((count) => count + 1); };
    document.addEventListener('focusin', again);
    document.addEventListener('focusout', again);
    return () => {
      document.removeEventListener('focusin', again);
      document.removeEventListener('focusout', again);
    };
  }, []);

  if (!view || view.isDestroyed || !view.editable) return null;
  const graph = graphKey.getState(view.state);
  if (!graph) return null;
  const { marker, open, seq } = graph;
  if (open !== null && marker) return <GraphFields key={seq} view={view} container={container} marker={marker} />;
  if (!view.hasFocus() || view.composing) return null;
  const canWrap = wrapRange(view.state) !== null;
  const canMark = graphMetaTarget(view.state) !== null;
  if (!canWrap && !canMark && !marker) return null;
  return <GraphBar view={view} container={container} marker={marker} canWrap={canWrap} canMark={canMark} />;
}

function GraphBar({ view, container, marker, canWrap, canMark }: {
  view: EditorView;
  container: RefObject<HTMLElement | null>;
  marker: Marker | null;
  canWrap: boolean;
  canMark: boolean;
}) {
  const run = (action: GraphAction) => { graphCommand(action)(view.state, view.dispatch, view); };
  const bar = useRef<HTMLDivElement>(null);
  const { from, to } = view.state.selection;
  // Hidden until the editor's bubble is placed, so the bar does not jump.
  const { docked, waiting } = useDock(view, container, bar, `${String(from)}-${String(to)}`, true);
  return createPortal(
    <div
      ref={bar}
      role="toolbar"
      aria-label="Graph"
      data-docked={docked}
      className="studio-popup fixed top-0 left-0 z-40 flex max-w-[calc(100vw-16px)] flex-wrap gap-0.5 p-[3px]"
      style={{ visibility: waiting ? 'hidden' : 'visible' }}
    >
      <BarButton icon={<Highlighter size={14} aria-hidden />} label="Keyword" keys="K" disabled={!canWrap} onRun={() => { run('Keyword'); }} />
      <BarButton icon={<Tag size={14} aria-hidden />} label="Tag" keys="T" disabled={!canWrap} onRun={() => { run('Tag'); }} />
      <BarButton icon={<Sprout size={14} aria-hidden />} label="Graph node" keys="G" disabled={!canMark} onRun={() => { run('GraphMeta'); }} />
      {marker && <BarButton icon={<PencilLine size={14} aria-hidden />} label={`Edit ${LABELS[marker.kind].toLowerCase()} id`} onRun={() => { run('edit'); }} />}
    </div>,
    document.body,
  );
}

function BarButton({ icon, label, keys, disabled, onRun }: { icon: ReactNode; label: string; keys?: string; disabled?: boolean; onRun: () => void }) {
  return (
    <button
      type="button"
      className="studio-popup-button"
      disabled={disabled}
      title={keys ? `${label} (${shortcut(keys)})` : label}
      // The editor keeps the focus and the selection.
      onMouseDown={(event) => {
        event.preventDefault();
        if (!disabled) onRun();
      }}
    >
      {icon}
      {label}
      {keys && <kbd>{shortcut(keys)}</kbd>}
    </button>
  );
}

// A marker's id and displayName, and its text where it can be rewritten.
// A new marker (no id yet) takes its id and displayName from the text until
// they are edited. Enter or a click elsewhere writes them, Escape leaves
// the marker as it is.
function GraphFields({ view, container, marker }: { view: EditorView; container: RefObject<HTMLElement | null>; marker: Marker }) {
  const fresh = !marker.attrs.id;
  const [text, setText] = useState(marker.text);
  const [id, setId] = useState(marker.attrs.id ?? '');
  const [name, setName] = useState(marker.attrs.displayName ?? marker.attrs.displayname ?? '');
  const [follow, setFollow] = useState(fresh);
  const root = useRef<HTMLFormElement>(null);
  const first = useRef<HTMLInputElement>(null);
  // The bubble hides while the fields have the focus: under the selection,
  // or above it with no room below.
  useDock(view, container, root, 'fields', false);
  const derived = defaults(text);
  const values = { id: follow ? derived.id : id, displayName: follow ? derived.displayName : name, text };

  const close = (write: boolean) => {
    // The marker as it is now: an edit from disk may have moved it.
    const current = markerAt(view.state);
    const unchanged = values.id === (marker.attrs.id ?? '')
      && values.displayName === (marker.attrs.displayName ?? marker.attrs.displayname ?? '')
      && values.text === marker.text;
    const tr = write && current && !unchanged ? updateMarker(view.state, current, values) : view.state.tr;
    view.dispatch(tr.setMeta(graphKey, { open: false }));
    view.focus();
  };
  const writeOnLeave = useEffectEvent(() => { close(true); });

  useEffect(() => {
    first.current?.focus();
    first.current?.select();
    // A press anywhere else writes the fields, before the editor moves the
    // caret off the marker.
    const outside = (event: MouseEvent) => {
      if (!(event.target instanceof Node && root.current?.contains(event.target))) writeOnLeave();
    };
    document.addEventListener('mousedown', outside, true);
    return () => { document.removeEventListener('mousedown', outside, true); };
  }, []);

  const field = (label: string, value: string, set: (value: string) => void, own: boolean) => (
    <label className="grid grid-cols-[86px_minmax(0,1fr)] items-center gap-2">
      <span className="text-[11.5px] text-[var(--fde-muted-foreground)]">{label}</span>
      <input
        ref={own ? first : undefined}
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => { set(event.target.value); }}
        className="min-w-0 rounded-md border border-[var(--fde-border)] bg-[var(--fde-background)] px-[7px] py-1 font-mono text-[12px] outline-none focus-visible:outline-2 focus-visible:outline-[var(--fde-ring)]"
      />
    </label>
  );

  return createPortal(
    <form
      ref={root}
      role="dialog"
      aria-label={`${LABELS[marker.kind]} id`}
      className="studio-popup fixed top-0 left-0 z-40 grid w-[min(330px,calc(100vw-16px))] gap-[7px] px-3 py-2.5 text-[12.5px]"
      onKeyDown={(event) => {
        if (composing(event)) {
          if (event.key === 'Enter') event.preventDefault();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          view.dispatch(closeGraphFields(view.state));
          view.focus();
        }
        // Not left to the form's implicit submit, which needs a rendered
        // submit button in some browsers.
        if (event.key === 'Enter') {
          event.preventDefault();
          close(true);
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        close(true);
      }}
    >
      {marker.content !== null && field('Text', text, setText, true)}
      {field('id', values.id, (value) => {
        setFollow(false);
        setId(value);
        setName(values.displayName);
      }, marker.content === null)}
      {field('displayName', values.displayName, (value) => {
        setFollow(false);
        setId(values.id);
        setName(value);
      }, false)}
      <div className="flex flex-wrap justify-between gap-2 text-[11px] text-[var(--fde-muted-foreground)]">
        <span>Enter saves · Esc closes</span>
        <button type="button" className="font-medium text-[var(--color-graph-primary)]" onClick={() => { setFollow(true); }}>
          Use defaults
        </button>
      </div>
    </form>,
    document.body,
  );
}
