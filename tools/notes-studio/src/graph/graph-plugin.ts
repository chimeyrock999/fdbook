import { keydownHandler } from '@tiptap/pm/keymap';
import { Plugin, PluginKey, type Command, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { composing } from '../keyboard';
import { addGraphMeta, markerAt, removeMarker, wrapSelection, type Marker } from './markers';
import { OPEN_GRAPH_FIELDS } from './meta';
import { createRelay } from '../editor/extensions';

// The marker at the selection; which marker the graph fields are open for,
// by the position it starts at, and `seq`, counting each time they open; and
// the marker whose fields were just closed: a marker with no id opens its
// fields when the caret reaches it, but not again until the caret leaves it
// and comes back.
export type GraphState = { marker: Marker | null; open: number | null; seq: number; dismissed: number | null };

export const graphKey = new PluginKey<GraphState>('studioGraph');

export type GraphAction = 'Keyword' | 'Tag' | 'GraphMeta' | 'edit' | 'remove';

// What a graph action does at the selection, as a ProseMirror command:
// Keyword and Tag wrap the selection, GraphMeta marks the caret's heading,
// and each opens the fields of the marker it made. With nothing to make,
// Keyword, Tag and GraphMeta open the fields of a marker already there of
// that kind, and `edit` of any marker. `remove` takes the marker there off.
export function graphCommand(action: GraphAction): Command {
  return (state, dispatch, view) => {
    if (view && !view.editable) return false;
    const made = action === 'Keyword' || action === 'Tag' ? wrapSelection(state, action) : action === 'GraphMeta' ? addGraphMeta(state) : null;
    if (made) {
      dispatch?.(made.setMeta(graphKey, { open: true }).scrollIntoView());
      return true;
    }
    const marker = markerAt(state);
    if (!marker) return false;
    if (action === 'remove') {
      dispatch?.(removeMarker(state, marker).scrollIntoView());
      return true;
    }
    if (action !== 'edit' && marker.kind !== action) return false;
    dispatch?.(state.tr.setMeta(graphKey, { open: true }));
    return true;
  };
}

export function closeGraphFields(state: EditorState) {
  return state.tr.setMeta(graphKey, { open: false });
}

const keys = keydownHandler({
  'Mod-Alt-k': graphCommand('Keyword'),
  'Mod-Alt-t': graphCommand('Tag'),
  'Mod-Alt-g': graphCommand('GraphMeta'),
  'Mod-Alt-x': graphCommand('remove'),
});

// The graph actions on a live editor: their shortcuts and the open/closed
// state of the fields. `onUpdate` gets the view after every update, and
// once more `gone` when its editor goes, for the UI that draws the bar and
// the fields.
export function graphPlugin(onUpdate: (view: EditorView, gone: boolean) => void): Plugin<GraphState> {
  return new Plugin<GraphState>({
    key: graphKey,
    state: {
      init: (_config, state) => ({ marker: markerAt(state), open: null, seq: 0, dismissed: null }),
      apply(tr, value, _old, state) {
        const marker = tr.docChanged || tr.selectionSet ? markerAt(state) : value.marker;
        const at = marker?.extent.from ?? null;
        let open = value.open === null ? null : tr.mapping.map(value.open);
        let dismissed = value.dismissed === null ? null : tr.mapping.map(value.dismissed);
        const meta = tr.getMeta(graphKey) as { open: boolean } | undefined;
        if (meta?.open === true || tr.getMeta(OPEN_GRAPH_FIELDS) === true) open = at;
        else if (meta?.open === false) {
          dismissed = open ?? at;
          open = null;
        }
        if (open !== at) open = null;
        if (dismissed !== at) dismissed = null;
        if (open === null && at !== null && dismissed !== at && !marker?.attrs.id) open = at;
        const seq = open !== null && value.open === null ? value.seq + 1 : value.seq;
        return { marker, open, seq, dismissed };
      },
    },
    props: {
      // ProseMirror leaves out keydowns during a composition, but not the
      // one Safari sends right after it.
      handleKeyDown: (view, event) => !composing(event) && keys(view, event),
    },
    view(view) {
      onUpdate(view, false);
      return {
        update: (next) => { onUpdate(next, false); },
        destroy: () => { onUpdate(view, true); },
      };
    },
  });
}

// The graph plugin, for the editor root's `extensions`, and the live
// editor it is on, for GraphTools: null once that editor went (a Source/
// Visual switch may build the next one before the last one goes).
export function createGraphSource() {
  const view = createRelay<EditorView | null>(null);
  const plugin = graphPlugin((next, gone) => {
    if (!gone) view.set(next);
    else if (view.get() === next) view.set(null);
  });
  return { plugin, listen: view.listen };
}

export type GraphSource = ReturnType<typeof createGraphSource>;
