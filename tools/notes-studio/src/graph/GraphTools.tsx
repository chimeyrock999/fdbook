import type { EditorView } from '@tiptap/pm/view';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { composing } from '../keyboard';
import { usePlaceAt } from './place';
import { closeGraphFields, graphCommand, graphKey, type GraphSource } from './graph-plugin';
import { listedIn } from './listed';
import { defaults, markerAt, updateMarker, type Marker } from './markers';

const LABELS: Record<Marker['kind'], string> = { Keyword: 'Keyword', Tag: 'Tag', GraphMeta: 'Graph node' };

// The fields of a marker's id and displayName, on the live editor through
// `source`'s plugin. The rest of the graph tools live in the editor: Keyword
// and Tag in its format bubble (bubble-items.tsx), the Graph button of a
// heading and a click on a marker in the plugin (graph-plugin.ts). `graph`
// is the note's graph frontmatter, to say where it lists the marker's id.
export function GraphTools({ source, graph }: { source: GraphSource; graph?: unknown }) {
  const [view, setView] = useState<EditorView | null>(null);
  const [, redraw] = useState(0);
  useEffect(() => source.listen((next) => {
    setView(next);
    redraw((count) => count + 1);
  }), [source]);

  if (!view || view.isDestroyed || !view.editable) return null;
  const state = graphKey.getState(view.state);
  if (!state) return null;
  const { marker, open, seq } = state;
  if (open === null || !marker) return null;
  return <GraphFields key={seq} view={view} marker={marker} listed={listedIn(graph, marker.attrs.id ?? '')} />;
}

// Where the frontmatter lists the marker's id: removing the marker leaves
// those entries as they are.
function ListedNote({ id, listed }: { id: string | undefined; listed: string[] }) {
  if (!id || listed.length === 0) return null;
  return (
    <div role="note" className="studio-popup-note">
      <TriangleAlert size={12} aria-hidden />
      <span>
        id <code>{id}</code> is also listed in <code>{listed.join(', ')}</code>. Remove leaves the frontmatter as it is.
      </span>
    </div>
  );
}

// A marker's id and displayName, and its text where it can be rewritten.
// A new marker (no id yet) takes its id and displayName from the text until
// they are edited. Enter or a click elsewhere writes them, Escape leaves
// the marker as it is, Remove takes it off without writing them.
function GraphFields({ view, marker, listed }: { view: EditorView; marker: Marker; listed: string[] }) {
  const fresh = !marker.attrs.id;
  const [text, setText] = useState(marker.text);
  const [id, setId] = useState(marker.attrs.id ?? '');
  const [name, setName] = useState(marker.attrs.displayName ?? marker.attrs.displayname ?? '');
  const [follow, setFollow] = useState(fresh);
  const root = useRef<HTMLFormElement>(null);
  const first = useRef<HTMLInputElement>(null);
  // Under the marker (a heading's title with its graph node), or above it
  // with no room below.
  const anchor = marker.content?.type === 'range' && marker.kind === 'GraphMeta' ? marker.content.from : marker.extent.from;
  usePlaceAt(view, root, anchor, marker.extent.to);
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
  const remove = () => {
    if (!graphCommand('remove')(view.state, view.dispatch, view)) view.dispatch(closeGraphFields(view.state));
    view.focus();
  };

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
        // Enter on a button is the button's.
        if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) return;
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
      <ListedNote id={marker.attrs.id} listed={listed} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--fde-muted-foreground)]">
        <span>Enter saves · Esc closes</span>
        <span className="flex gap-3">
          <button type="button" className="font-medium hover:text-[var(--fde-warning)] focus-visible:text-[var(--fde-warning)]" onClick={remove}>
            Remove {LABELS[marker.kind].toLowerCase()}
          </button>
          <button type="button" className="font-medium text-[var(--color-graph-primary)]" onClick={() => { setFollow(true); }}>
            Use defaults
          </button>
        </span>
      </div>
    </form>,
    document.body,
  );
}
