import type { Mark, Node as PmNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { TEXT_DIRECTIVE, jsxMarkers, plainLabel } from '../plugins/graph-objects/decorate';
import { attributeSpans, attributes } from '../plugins/source-attributes';
import { slugify } from '../slug';

// The graph markers of components/graph-objects.tsx as the Studio edits
// them: wrap a selection as a <Keyword>/<Tag>, mark a heading with
// :graph-meta, and rewrite a marker's id and displayName. Only the marker's
// own source changes; every other byte of the note stays.

export type MarkerKind = 'Keyword' | 'Tag' | 'GraphMeta';

export type Marker = {
  kind: MarkerKind;
  // Where the attributes live: a JSX opening (or self-closing) tag, or a
  // text directive atom.
  source: { type: 'tag'; from: number; to: number } | { type: 'atom'; pos: number };
  // The whole marker: through the closing tag of a keyword.
  extent: { from: number; to: number };
  attrs: Partial<Record<string, string>>;
  // The text the defaults come from (a keyword's text, a heading's title),
  // without its outer whitespace.
  text: string;
  // Where that text can be rewritten: a plain range, the directive's
  // [label], or nowhere (a heading with other markup in its title).
  content: { type: 'range'; from: number; to: number } | { type: 'label' } | null;
};

export type GraphValues = { id: string; displayName: string; text: string };

const KINDS: Record<string, MarkerKind> = { Keyword: 'Keyword', Tag: 'Tag', keyword: 'Keyword', tag: 'Tag', GraphMeta: 'GraphMeta', 'graph-meta': 'GraphMeta' };

function isTagText(node: PmNode) {
  return node.isText && node.marks.some((mark) => mark.type.name === 'mdxJsxTag');
}

// A textblock's text without its JSX tags and inline atoms.
function plainText(block: PmNode, from = 0, to = block.content.size) {
  let text = '';
  block.nodesBetween(from, to, (node, pos) => {
    if (node.isText && !isTagText(node)) text += (node.text ?? '').slice(Math.max(0, from - pos), to - pos);
  });
  return text;
}

// Whether a range of a textblock is text with one set of marks all along,
// so it can be rewritten as one text node without losing formatting.
function uniformText(block: PmNode, from: number, to: number) {
  let marks: readonly Mark[] | null = null;
  let uniform = true;
  block.nodesBetween(from, to, (node) => {
    if (!node.isText || isTagText(node)) uniform = false;
    else if (marks === null) marks = node.marks;
    else if (!node.sameMarkup(node.mark(marks))) uniform = false;
  });
  return uniform;
}

// The markers in one textblock, in document order; `start` is the position
// of its content.
export function markersIn(block: PmNode, start: number): Marker[] {
  const out: Marker[] = [];
  for (const { name, open, close } of jsxMarkers(block, start)) {
    if (!close) {
      out.push({ kind: 'GraphMeta', source: { type: 'tag', from: open.from, to: open.to }, extent: { from: open.from, to: open.to }, attrs: open.attrs, text: '', content: null });
      continue;
    }
    const inner = { from: open.to - start, to: close.from - start };
    out.push({
      kind: KINDS[name],
      source: { type: 'tag', from: open.from, to: open.to },
      extent: { from: open.from, to: close.to },
      attrs: open.attrs,
      text: plainText(block, inner.from, inner.to).trim(),
      content: uniformText(block, inner.from, inner.to) ? { type: 'range', from: open.to, to: close.from } : null,
    });
  }
  block.forEach((child, offset) => {
    if (child.type.name !== 'verbatimInline') return;
    const match = TEXT_DIRECTIVE.exec(String(child.attrs.value));
    if (!match) return;
    const attrs = match[3] ? attributes(match[3].slice(1, -1)) : {};
    const label = match.at(2);
    out.push({
      kind: KINDS[match[1]],
      source: { type: 'atom', pos: start + offset },
      extent: { from: start + offset, to: start + offset + child.nodeSize },
      attrs,
      text: label === undefined ? '' : plainLabel(label).trim(),
      content: label === undefined ? null : { type: 'label' },
    });
  });
  out.sort((a, b) => a.extent.from - b.extent.from);
  // A heading's marker takes its title as text.
  if (block.type.name === 'heading') {
    for (const marker of out) {
      if (marker.kind !== 'GraphMeta') continue;
      const at = marker.extent.from - start;
      const title = plainText(block, 0, at);
      const end = title.trimEnd().length;
      marker.text = title.trim();
      const plain = uniformText(block, 0, at);
      marker.content = plain && end > 0 ? { type: 'range', from: start, to: start + end } : null;
    }
  }
  return out;
}

// The marker the selection is on: a selected directive atom, a JSX tag or
// keyword around the selection, or the graph-meta of the heading the
// caret is in.
export function markerAt(state: EditorState): Marker | null {
  const { selection } = state;
  if (selection instanceof NodeSelection) {
    const $pos = state.doc.resolve(selection.from);
    if (!$pos.parent.isTextblock) return null;
    return markersIn($pos.parent, $pos.start()).find((marker) => marker.source.type === 'atom' && marker.source.pos === selection.from) ?? null;
  }
  const { $from, $to } = selection;
  if (!$from.parent.isTextblock || !$from.sameParent($to)) return null;
  const markers = markersIn($from.parent, $from.start());
  const around = markers.find((marker) => marker.source.type === 'tag' && selection.from >= marker.extent.from && selection.to <= marker.extent.to);
  if (around) return around;
  if ($from.parent.type.name === 'heading') return markers.find((marker) => marker.kind === 'GraphMeta') ?? null;
  return null;
}

// The selection as a keyword would take it: inside one textblock, plain
// text only (no JSX tag, atom or inline code), not inside another marker,
// with its outer whitespace left out.
export function wrapRange(state: EditorState): { from: number; to: number; text: string } | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || selection.empty) return null;
  const { $from, $to } = selection;
  if (!$from.sameParent($to) || !$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  const raw = state.doc.textBetween(selection.from, selection.to);
  const from = selection.from + (raw.length - raw.trimStart().length);
  const to = selection.to - (raw.length - raw.trimEnd().length);
  if (from >= to) return null;
  // Set in the callback, which TypeScript does not follow.
  let plain = true as boolean;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isTextblock) return true;
    if (!node.isText || isTagText(node) || node.marks.some((mark) => mark.type.name === 'code')) plain = false;
    return false;
  });
  if (!plain) return null;
  const inside = markersIn($from.parent, $from.start()).some((marker) => from < marker.extent.to && to > marker.extent.from);
  const text = state.doc.textBetween(from, to);
  if (inside || slugify(text) === '') return null;
  return { from, to, text };
}

// Marks every character of the range carries (bold around the whole
// keyword), so the tags sit inside them and the Markdown around stays as it
// was. A mark that stops and starts again inside the range is not one of
// them: the keyword then holds both runs.
function sharedMarks(state: EditorState, from: number, to: number): readonly Mark[] {
  // Set in the callback, which TypeScript does not follow.
  let shared = null as readonly Mark[] | null;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true;
    shared = shared === null ? node.marks : shared.filter((mark) => mark.isInSet(node.marks));
    return false;
  });
  return shared ?? [];
}

// A JSX or directive attribute value, quoted.
function quote(value: string) {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  return `"${value.replaceAll('"', "'")}"`;
}

const SPELLINGS: Record<string, string[]> = { displayName: ['displayName', 'displayname'] };

// An attribute list (`id="a" displayName="A"`) with these values set: an
// existing attribute keeps its place and spelling, a missing one is added
// at the end.
export function withAttributes(list: string, values: Record<string, string>) {
  let out = list;
  for (const [name, value] of Object.entries(values)) {
    const spans = attributeSpans(out);
    const span = (SPELLINGS[name] ?? [name]).map((spelling) => spans.find((item) => item.name === spelling)).find((item) => item !== undefined);
    out = span
      ? `${out.slice(0, span.from)}${span.name}=${quote(value)}${out.slice(span.to)}`
      : `${out.trimEnd()}${out.trim() ? ' ' : ''}${name}=${quote(value)}`;
  }
  return out;
}

const JSX_TAG = /^(<[A-Za-z][\w.:-]*)([\s\S]*?)(\s*\/?>)$/;

function withTagAttributes(tag: string, values: Record<string, string>) {
  const match = JSX_TAG.exec(tag);
  if (!match) return tag;
  const list = withAttributes(match[2], values);
  return `${match[1]}${list.startsWith(' ') || list === '' ? '' : ' '}${list}${match[3]}`;
}

function withDirective(value: string, values: Record<string, string>, label?: string) {
  const match = TEXT_DIRECTIVE.exec(value);
  if (!match) return value;
  const own = label === undefined ? match.at(2) : label.replace(/[[\]]/g, '\\$&');
  const list = withAttributes(match[3] ? match[3].slice(1, -1) : '', values);
  return `:${match[1]}${own === undefined ? '' : `[${own}]`}{${list}}`;
}

// The defaults for a marker's fields: the id slugged from its text and
// that text as its display name.
export function defaults(text: string): Pick<GraphValues, 'id' | 'displayName'> {
  return { id: slugify(text), displayName: text.trim() };
}

// Wraps the selection in <Keyword> or <Tag> with the default id and
// displayName. The caret ends inside the new keyword, so it is the marker
// at the selection.
export function wrapSelection(state: EditorState, kind: 'Keyword' | 'Tag'): Transaction | null {
  const range = wrapRange(state);
  if (!range) return null;
  const { schema, tr } = state;
  const marks = schema.marks.mdxJsxTag.create({ self: false }).addToSet(sharedMarks(state, range.from, range.to));
  const { id, displayName } = defaults(range.text);
  const open = `<${kind} id=${quote(id)} displayName=${quote(displayName)}>`;
  tr.insert(range.to, schema.text(`</${kind}>`, marks));
  tr.insert(range.from, schema.text(open, marks));
  return tr.setSelection(TextSelection.create(tr.doc, range.to + open.length));
}

// Whether the caret's heading can take a :graph-meta: it has a title and
// no marker of its own yet.
export function graphMetaTarget(state: EditorState): { pos: number; text: string } | null {
  const { $from } = state.selection;
  if ($from.parent.type.name !== 'heading' || !$from.sameParent(state.selection.$to)) return null;
  if (markersIn($from.parent, $from.start()).some((marker) => marker.kind === 'GraphMeta')) return null;
  const text = plainText($from.parent).trim();
  return slugify(text) === '' ? null : { pos: $from.end(), text };
}

// Adds `:graph-meta{id=… displayName=…}` at the end of the caret's heading.
export function addGraphMeta(state: EditorState): Transaction | null {
  const target = graphMetaTarget(state);
  if (!target) return null;
  const { schema, tr } = state;
  const { id, displayName } = defaults(target.text);
  const atom = schema.nodes.verbatimInline.create({ value: `:graph-meta{id=${quote(id)} displayName=${quote(displayName)}}` });
  const before = state.doc.resolve(target.pos).nodeBefore;
  const spaced = before?.isText && /\s$/.test(before.text ?? '');
  return tr.insert(target.pos, spaced ? atom : [schema.text(' '), atom]);
}

// Writes a marker's id and displayName, and its text when that changed and
// can be rewritten. Later positions first, so earlier ones stay valid.
export function updateMarker(state: EditorState, marker: Marker, values: GraphValues): Transaction {
  const { tr, schema } = state;
  const attrs = { id: values.id.trim(), displayName: values.displayName.trim() };
  const text = values.text.trim();
  const retext = text !== '' && text !== marker.text;
  const writeSource = () => {
    if (marker.source.type === 'atom') {
      const node = tr.doc.nodeAt(marker.source.pos);
      if (!node) return;
      const label = retext && marker.content?.type === 'label' ? text : undefined;
      tr.setNodeMarkup(marker.source.pos, undefined, { ...node.attrs, value: withDirective(String(node.attrs.value), attrs, label) });
    } else {
      const { from, to } = marker.source;
      const node = tr.doc.nodeAt(from);
      tr.replaceWith(from, to, schema.text(withTagAttributes(tr.doc.textBetween(from, to), attrs), node?.marks));
    }
  };
  const writeText = () => {
    if (!retext || marker.content?.type !== 'range') return;
    const { from, to } = marker.content;
    tr.replaceWith(from, to, schema.text(text, tr.doc.nodeAt(from)?.marks));
  };
  if (marker.content?.type === 'range' && marker.content.from > marker.extent.from) {
    writeText();
    writeSource();
  } else {
    writeSource();
    writeText();
  }
  return tr;
}
