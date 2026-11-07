import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

// What the editor marks: each hunk's blocks to replace (by top-level index:
// the editor's document holds the note's blocks in order, the frontmatter
// first) and where its card goes, and each comment's block.
export type VisualMarks = {
  hunks: { key: string; first: number; count: number; stale: boolean; focus: boolean }[];
  comments: { key: string; block: number }[];
};

const key = new PluginKey('studioSuggestions');

// The live marks and the elements the cards are drawn into (by React,
// through portals): one element per key, kept across redraws so a card
// keeps its state.
export function createSuggestionLayer() {
  let marks: VisualMarks = { hunks: [], comments: [] };
  const elements = new Map<string, HTMLElement>();
  const views = new Set<EditorView>();

  const element = (id: string, className: string) => {
    let found = elements.get(id);
    if (found === undefined) {
      found = document.createElement('div');
      found.className = className;
      found.contentEditable = 'false';
      found.dataset.suggestion = id;
      elements.set(id, found);
    }
    return found;
  };

  function decorations(state: EditorState) {
    const starts: number[] = [];
    state.doc.forEach((_node, offset) => { starts.push(offset); });
    const end = (index: number) => starts[index] + (state.doc.child(index).nodeSize);
    const found: Decoration[] = [];
    for (const hunk of marks.hunks) {
      // The document and the text can be a keystroke apart: skip what does not fit.
      if (hunk.first + hunk.count > starts.length) continue;
      for (let index = hunk.first; index < hunk.first + hunk.count; index += 1) {
        found.push(Decoration.node(starts[index], end(index), { class: `studio-suggest-removed${hunk.stale ? ' studio-suggest-stale' : ''}` }));
      }
      const at = hunk.count > 0 ? end(hunk.first + hunk.count - 1) : hunk.first < starts.length ? starts[hunk.first] : state.doc.content.size;
      const dom = element(hunk.key, 'studio-suggest-card');
      dom.dataset.focus = String(hunk.focus);
      dom.dataset.stale = String(hunk.stale);
      found.push(Decoration.widget(at, dom, { key: `hunk:${hunk.key}`, side: hunk.count > 0 ? 1 : -1, stopEvent: () => true, ignoreSelection: true }));
    }
    for (const comment of marks.comments) {
      if (comment.block >= starts.length) continue;
      found.push(Decoration.widget(starts[comment.block], element(`c:${comment.key}`, 'studio-suggest-comment'), { key: `comment:${comment.key}`, side: -1, stopEvent: () => true, ignoreSelection: true }));
    }
    return DecorationSet.create(state.doc, found);
  }

  const plugin = new Plugin({
    key,
    props: { decorations },
    view(view) {
      views.add(view);
      return { destroy: () => { views.delete(view); } };
    },
  });

  return {
    plugin,
    element,
    // New marks: the editors draw them again.
    set(next: VisualMarks) {
      marks = next;
      // A decided suggestion's element goes with it.
      const kept = new Set([...next.hunks.map((hunk) => hunk.key), ...next.comments.map((comment) => `c:${comment.key}`)]);
      for (const id of [...elements.keys()]) if (!kept.has(id)) elements.delete(id);
      for (const view of views) if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true).setMeta('addToHistory', false));
    },
  };
}

export type SuggestionLayer = ReturnType<typeof createSuggestionLayer>;
