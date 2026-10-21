import { parseMdxToDoc } from '@fumadocs-editor/core';
import { Fragment, Node as PmNode, type Mark } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { editorSyntax } from '../plugins';
import { TEXT_DIRECTIVE, jsxMarkers, plainLabel } from '../plugins/graph-objects/decorate';
import { attributeSpans, attributes } from '../plugins/source-attributes';
import { slugify } from '../slug';

// The graph markers of components/graph-objects.tsx as the Studio edits
// them: wrap a selection as a <Keyword>/<Tag>, mark a heading with
// :graph-meta, rewrite a marker's id and displayName, and remove a marker.
// Only the marker's own source changes; every other byte of the note stays.

export type MarkerKind = 'Keyword' | 'Tag' | 'GraphMeta';

export type Marker = {
  kind: MarkerKind;
  // Where the attributes live: a JSX opening (or self-closing) tag, with the
  // closing tag of a keyword, or a text directive atom.
  source: { type: 'tag'; from: number; to: number; close: { from: number; to: number } | null } | { type: 'atom'; pos: number };
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

// What changes how a directive label reads: Markdown emphasis and code, the
// label's own brackets, the escape itself, and MDX, since the site parses
// the label as MDX (`{` starts an expression, `<` a tag).
const LABEL_MARKUP = /[\\*_`[\]{<]/g;

// A directive label as text: plain when it has no Markdown but escapes, so
// it can be written back from the text; otherwise its text without the
// emphasis marks, read only.
function readLabel(label: string): { text: string; plain: boolean } {
  const plain = !/(^|[^\\])(\\\\)*[*_`[\]{<]/.test(label) && !/(^|[^\\])(\\\\)*\\$/.test(label);
  return plain ? { text: label.replace(/\\(.)/g, '$1').trim(), plain } : { text: plainLabel(label).trim(), plain };
}

function escapeLabel(text: string) {
  return text.replace(LABEL_MARKUP, '\\$&');
}

// The markers in one textblock, in document order; `start` is the position
// of its content.
export function markersIn(block: PmNode, start: number): Marker[] {
  const out: Marker[] = [];
  for (const { name, open, close } of jsxMarkers(block, start)) {
    if (!close) {
      out.push({ kind: 'GraphMeta', source: { type: 'tag', from: open.from, to: open.to, close: null }, extent: { from: open.from, to: open.to }, attrs: open.attrs, text: '', content: null });
      continue;
    }
    const inner = { from: open.to - start, to: close.from - start };
    out.push({
      kind: KINDS[name],
      source: { type: 'tag', from: open.from, to: open.to, close: { from: close.from, to: close.to } },
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
    const read = label === undefined ? null : readLabel(label);
    out.push({
      kind: KINDS[match[1]],
      source: { type: 'atom', pos: start + offset },
      extent: { from: start + offset, to: start + offset + child.nodeSize },
      attrs,
      text: read?.text ?? '',
      content: read?.plain ? { type: 'label' } : null,
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
  // The innermost of nested keywords: the last one around it to start.
  const around = markers.filter((marker) => marker.source.type === 'tag' && selection.from >= marker.extent.from && selection.to <= marker.extent.to).at(-1);
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

// A JSX or directive attribute value, quoted. A value with both quote kinds
// cannot be written as it is: its double quotes become single ones.
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
  const own = label === undefined ? match.at(2) : escapeLabel(label);
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

// A directive label as the inline content it reads as, with `marks` (the
// atom's own) added: its Markdown as Markdown, its escapes as the
// characters they stand for, the spaces inside its brackets kept. It is
// parsed after a word, as it sits in its paragraph: on its own, `1. x`
// would be a list, `# x` a heading and `import x` an ESM statement. Should
// it still not read as one paragraph, it goes back as its text.
function labelContent(state: EditorState, label: string, marks: readonly Mark[]): Fragment {
  const { schema } = state;
  const lead = /^\s*/.exec(label)?.[0] ?? '';
  const trail = /\s*$/.exec(label.slice(lead.length))?.[0] ?? '';
  const body = label.slice(lead.length, label.length - trail.length);
  if (body === '') return Fragment.from(lead || trail ? [schema.text(lead + trail, marks)] : []);
  let nodes: PmNode[] | null = null;
  try {
    const blocks = parseMdxToDoc(`a ${body}`, editorSyntax()).doc.content ?? [];
    if (blocks.length === 1 && blocks[0].type === 'paragraph') {
      const parsed: PmNode[] = [];
      PmNode.fromJSON(schema, blocks[0]).content.forEach((node) => { parsed.push(node); });
      const first = parsed.at(0);
      if (first?.isText && first.marks.length === 0 && first.text?.startsWith('a ')) {
        const rest = first.text.slice(2);
        nodes = rest === '' ? parsed.slice(1) : [schema.text(rest), ...parsed.slice(1)];
      }
    }
  } catch {
    // Not MDX on its own: read as text below.
  }
  nodes ??= [schema.text(body.replace(/\\(.)/g, '$1'))];
  if (lead) nodes.unshift(schema.text(lead));
  if (trail) nodes.push(schema.text(trail));
  return Fragment.from(nodes.map((node) => node.mark(marks.reduce((set, mark) => mark.addToSet(set), node.marks))));
}

// The range a marker that leaves nothing behind takes with it: the marker
// and one space beside it, so `Title :graph-meta{…}` becomes `Title`,
// `a <GraphMeta /> b` becomes `a b` and `a <GraphMeta />, b` `a, b`.
function withSpace(state: EditorState, from: number, to: number) {
  const plain = (node: PmNode | null | undefined, test: RegExp) => !!node?.isText && !isTagText(node) && test.test(node.text ?? '');
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  const before = plain($from.nodeBefore, /\s$/);
  const after = plain($to.nodeAfter, /^\s/);
  const closing = plain($to.nodeAfter, /^[.,;:!?)\]}…'"’”]/u);
  if (before && (after || closing || to === $to.end())) return { from: from - 1, to };
  if (after && from === $from.start()) return { from, to: to + 1 };
  return { from, to };
}

// Takes a marker off and keeps what it marked: a keyword's text with its
// Markdown, a directive's label as the text it reads as, a heading's title
// without the space its graph-meta added. One transaction, so one undo puts
// the marker back.
export function removeMarker(state: EditorState, marker: Marker): Transaction {
  const { tr } = state;
  const { source } = marker;
  if (source.type === 'tag' && source.close) {
    tr.delete(source.close.from, source.close.to);
    tr.delete(source.from, source.to);
    return tr;
  }
  const { from, to } = marker.extent;
  const node = source.type === 'atom' ? state.doc.nodeAt(source.pos) : null;
  const label = node && marker.kind !== 'GraphMeta' ? TEXT_DIRECTIVE.exec(String(node.attrs.value))?.at(2) : undefined;
  const content = node && label !== undefined ? labelContent(state, label, node.marks) : Fragment.empty;
  if (content.size > 0) return tr.replaceWith(from, to, content);
  const range = withSpace(state, from, to);
  return tr.delete(range.from, range.to);
}
