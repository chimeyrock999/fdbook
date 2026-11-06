import type { Node as PmNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type EditorState, type Selection } from '@tiptap/pm/state';
import { Decoration } from '@tiptap/pm/view';
import { keywordClassName, tagClassName } from '@site/components/graph-objects';
import { Sprout } from 'lucide';
import { OPEN_GRAPH_FIELDS } from '../../graph/meta';
import { icon } from '../icon';
import { attributes } from '../source-attributes';

// components/graph-objects.tsx in the editor. The editor keeps inline JSX as
// text marked `mdxJsxTag` and text directives (`:keyword[…]{…}`) as
// `verbatimInline` atoms, so these draw over them:
// - <Keyword>/<Tag> hide their tags and colour the text between;
// - <GraphMeta/> and :graph-meta{…} become a small marker;
// - :keyword[…]{…} and :tag[…]{…} show their label as a keyword.
// With the caret inside or at an edge (or the atom selected) the source shows
// again, so a Backspace never eats a tag the writer cannot see.

export type Tag = { from: number; to: number; name: string; kind: 'open' | 'close' | 'self'; attrs: Partial<Record<string, string>> };

const TAG = /<(\/?)([A-Za-z][\w.:-]*)((?:\s+[^\s"'=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;
export const KEYWORDS = new Set(['Keyword', 'Tag']);
export const GRAPH_META = new Set(['GraphMeta', 'graph-meta']);
export const TEXT_DIRECTIVE = /^:(keyword|tag|graph-meta)(?:\[([\s\S]*)\])?(\{[\s\S]*\})?$/;

// The JSX tags in one textblock, from its `mdxJsxTag` text runs.
export function tagsIn(block: PmNode, start: number): Tag[] {
  const tags: Tag[] = [];
  let run: { from: number; text: string } | null = null;
  const flush = () => {
    if (!run) return;
    for (const match of run.text.matchAll(TAG)) {
      const from = run.from + match.index;
      const kind = match[1] ? 'close' : match[4] ? 'self' : 'open';
      tags.push({ from, to: from + match[0].length, name: match[2], kind, attrs: attributes(match[3]) });
    }
    run = null;
  };
  block.forEach((child, offset) => {
    const pos = start + offset;
    if (child.isText && child.marks.some((mark) => mark.type.name === 'mdxJsxTag')) {
      if (run && run.from + run.text.length === pos) run.text += child.text ?? '';
      else {
        flush();
        run = { from: pos, text: child.text ?? '' };
      }
    } else flush();
  });
  flush();
  return tags;
}

// The graph markers among a textblock's JSX tags, in the order their last
// tag comes: a self-closing <GraphMeta/> (no `close`), or a <Keyword>/<Tag>
// with the nearest unclosed opening tag of the same name. The decorations
// and the Studio's edits (src/graph/markers.ts) pair tags by this one rule.
export type JsxMarker = { name: string; open: Tag; close: Tag | null };

export function jsxMarkers(block: PmNode, start: number): JsxMarker[] {
  const out: JsxMarker[] = [];
  const open: Tag[] = [];
  for (const tag of tagsIn(block, start)) {
    if (GRAPH_META.has(tag.name) && tag.kind === 'self') out.push({ name: tag.name, open: tag, close: null });
    else if (KEYWORDS.has(tag.name) && tag.kind === 'open') open.push(tag);
    else if (KEYWORDS.has(tag.name) && tag.kind === 'close') {
      let index = open.length - 1;
      while (index >= 0 && open[index].name !== tag.name) index--;
      if (index < 0) continue;
      const [opening] = open.splice(index, 1);
      out.push({ name: tag.name, open: opening, close: tag });
    }
  }
  return out;
}

function within(selection: Selection, from: number, to: number) {
  return selection.from >= from && selection.to <= to;
}

// The site's own <Keyword>/<Tag> classes (src/index.css scans the file), plus
// `studio-keyword` for the Studio's own rules and lookups.
export const KEYWORD_CLASS = `studio-keyword ${keywordClassName}`;
export const TAG_CLASS = `studio-keyword studio-keyword-tag ${tagClassName}`;

function hide(from: number, to: number) {
  return Decoration.inline(from, to, { class: 'studio-hidden' });
}

// What a graph object is called: its displayName (either spelling), else its
// id. An empty value counts as missing, the same for every form.
export function nameOf(attrs: Partial<Record<string, string>>) {
  return [attrs.displayName, attrs.displayname, attrs.id].find((value) => value) ?? '';
}

// A label for :keyword[…]: its text without the Markdown emphasis.
export function plainLabel(label: string) {
  return label.replace(/(\*\*|__|\*|_|`)/g, '');
}

export function decorateGraphObjects(state: EditorState): Decoration[] {
  const { selection } = state;
  const out: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      for (const { name, open: opening, close: tag } of jsxMarkers(node, pos + 1)) {
        if (!tag) {
          if (within(selection, opening.from, opening.to)) continue;
          out.push(hide(opening.from, opening.to), graphMarker(opening.from, nameOf(opening.attrs), 'text'));
          continue;
        }
        const shown = within(selection, opening.from, tag.to);
        if (!shown) out.push(hide(opening.from, opening.to), hide(tag.from, tag.to));
        if (tag.from > opening.to) {
          out.push(Decoration.inline(opening.to, tag.from, {
            class: name === 'Tag' ? TAG_CLASS : KEYWORD_CLASS,
            title: nameOf(opening.attrs),
          }));
        }
      }
      return true;
    }
    if (node.type.name !== 'verbatimInline') return true;
    const match = TEXT_DIRECTIVE.exec(String(node.attrs.value));
    if (!match) return false;
    const selected = selection instanceof NodeSelection && selection.from === pos;
    if (selected) return false;
    const attrs = match[3] ? attributes(match[3].slice(1, -1)) : {};
    const name = nameOf(attrs);
    out.push(Decoration.node(pos, pos + node.nodeSize, { class: 'studio-hidden' }));
    if (match[1] === 'graph-meta') out.push(graphMarker(pos, name, 'atom'));
    else out.push(keywordLabel(pos, plainLabel(match.at(2) ?? name), name, match[1] === 'tag'));
    return false;
  });
  return out;
}

// Clicking a marker puts the caret inside its source (into a JSX tag's
// text, or onto a directive atom) and opens its graph fields.
function reveal(view: { state: EditorState; dispatch: (tr: EditorState['tr']) => void; focus: () => void }, pos: number, target: 'text' | 'atom') {
  const { doc, tr } = view.state;
  const selection = target === 'text' ? TextSelection.create(doc, pos + 1) : NodeSelection.create(doc, pos);
  view.dispatch(tr.setSelection(selection).setMeta(OPEN_GRAPH_FIELDS, true));
  view.focus();
}

function graphMarker(pos: number, name: string, target: 'text' | 'atom') {
  return Decoration.widget(pos, (view, getPos) => {
    const marker = document.createElement('span');
    marker.className = 'studio-graph-meta';
    marker.dataset.name = name;
    marker.title = `GraphMeta · ${name}`;
    marker.setAttribute('aria-label', `GraphMeta ${name}`);
    marker.append(icon(Sprout, 11));
    marker.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const at = getPos();
      if (at !== undefined) reveal(view, at, target);
    });
    return marker;
  }, { side: -1, key: `graph-meta:${target}:${name}`, ignoreSelection: true });
}

function keywordLabel(pos: number, label: string, name: string, tag: boolean) {
  return Decoration.widget(pos, (view, getPos) => {
    const span = document.createElement('span');
    span.className = tag ? TAG_CLASS : KEYWORD_CLASS;
    span.textContent = label;
    span.title = name;
    span.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const at = getPos();
      if (at !== undefined) reveal(view, at, 'atom');
    });
    return span;
  }, { side: -1, key: `keyword:${String(tag)}:${label}:${name}`, ignoreSelection: true });
}
