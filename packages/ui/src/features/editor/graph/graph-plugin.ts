import { keydownHandler } from '@tiptap/pm/keymap';
import { Plugin, PluginKey, TextSelection, type Command, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { Sprout } from 'lucide';
import { composing } from '#lib/keyboard.ts';
import { icon } from '#features/editor/plugins/icon.ts';
import { addGraphMeta, headingTarget, markerAt, markersIn, removeMarker, wrapSelection, type Marker } from './markers';
import { OPEN_GRAPH_FIELDS } from './meta';
import { createRelay } from '#features/editor/extensions.ts';

// The marker at the selection; which marker the graph fields are open for,
// by the position it starts at, and `seq`, counting each time they open; and
// the marker whose fields were just closed: a marker with no id opens its
// fields when the caret reaches it, but not again until the caret leaves it
// and comes back.
export type GraphState = { marker: Marker | null; open: number | null; seq: number; dismissed: number | null };

export const graphKey = new PluginKey<GraphState>('studioGraph');

export type GraphAction = 'Keyword' | 'Tag' | 'GraphMeta' | 'remove';

// Where the note's graph frontmatter lists an id, per live editor; set by
// GraphTools from the note's `graph`.
const listings = new WeakMap<EditorView, (id: string) => string[]>();

export function setGraphListing(view: EditorView, listed: (id: string) => string[]) {
  listings.set(view, listed);
}

// Takes `marker` off, unless the frontmatter lists its id: then its fields
// open, which name those entries next to their Remove, so an entry is not
// left behind unseen. For a pressed Keyword or Tag and Mod-Alt-X; the
// fields' own Remove goes through removeMarker.
export function takeOff(marker: Marker): Command {
  return (state, dispatch, view) => {
    const listed = view && marker.attrs.id ? listings.get(view)?.(marker.attrs.id) ?? [] : [];
    if (listed.length > 0) dispatch?.(state.tr.setMeta(graphKey, { open: true }));
    else dispatch?.(removeMarker(state, marker).scrollIntoView());
    return true;
  };
}

// What a graph action does at the selection, as a ProseMirror command:
// Keyword and Tag wrap the selection, GraphMeta marks the caret's heading,
// and each opens the fields of the marker it made. With nothing to make,
// Keyword, Tag and GraphMeta open the fields of a marker already there of
// that kind. `remove` takes the marker there off (see takeOff).
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
    if (action === 'remove') return takeOff(marker)(state, dispatch, view);
    if (marker.kind !== action) return false;
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

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

// The Graph button at the end of a heading that can take a graph node: it
// marks the heading as Mod-Alt-G does at its caret, and opens the fields.
// CSS shows it while the heading is hovered or holds the caret
// (`studio-graph-here`), and never in a locked editor.
function graphButton(pos: number) {
  return Decoration.widget(pos, (view, getPos) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'studio-graph-add';
    button.contentEditable = 'false';
    button.title = `Add graph node (${MAC ? '⌘⌥G' : 'Ctrl+Alt+G'})`;
    button.append(icon(Sprout, 13), 'Graph');
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const at = getPos();
      if (at === undefined || !view.editable) return;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
      graphCommand('GraphMeta')(view.state, view.dispatch, view);
      view.focus();
    });
    return button;
  }, { side: 1, key: 'studio-graph-add', ignoreSelection: true, stopEvent: () => true });
}

function headingDecorations(state: EditorState) {
  const out: Decoration[] = [];
  const { $from, $to } = state.selection;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return !node.isTextblock;
    const target = headingTarget(node, pos + 1);
    if (target) out.push(graphButton(target.pos));
    if ($from.parent === node && $to.parent === node) out.push(Decoration.node(pos, pos + node.nodeSize, { class: 'studio-graph-here' }));
    return false;
  });
  return DecorationSet.create(state.doc, out);
}

// A plain click on a <Keyword> or <Tag> (the text the decorations colour)
// opens its fields, as a click on a directive's label or a graph node
// marker does: the caret goes there and the source shows.
function clickKeyword(view: EditorView, pos: number, event: MouseEvent) {
  if (!view.editable || event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (!(event.target instanceof Element) || !event.target.closest('span.studio-keyword')) return false;
  const $pos = view.state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return false;
  const marker = markersIn($pos.parent, $pos.start()).find((each) => each.kind !== 'GraphMeta' && each.source.type === 'tag' && pos >= each.source.to && pos <= (each.source.close?.from ?? -1));
  if (!marker) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).setMeta(graphKey, { open: true }));
  return true;
}

// The graph actions on a live editor: their shortcuts, the Graph button of
// each heading, a click on a keyword, and the open/closed state of the
// fields. `onUpdate` gets the view after every update, and once more
// `gone` when its editor goes, for the UI that draws the fields.
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
      handleClick: clickKeyword,
      decorations: headingDecorations,
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
