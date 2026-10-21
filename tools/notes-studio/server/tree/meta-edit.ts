import { isMap, isScalar, isSeq, parse, parseDocument, Scalar, type YAMLSeq } from 'yaml';

// Edits to the `pages` list of a meta.yaml, and to its true/false keys.
// The YAML document only says where each entry sits; the edit itself
// replaces those characters in the text, so everything else (comments, blank lines, `icon`, `visible`, quote
// style, a missing final newline) stays byte for byte.

export class MetaEditError extends Error {}

type Entry = { value: unknown; start: number; end: number; type: Scalar.Type | undefined };
type Pages = { seq: YAMLSeq; entries: Entry[]; keyEnd: number; end: number };

function pagesOf(text: string): Pages | null {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new MetaEditError(`meta.yaml does not parse: ${doc.errors[0]?.message ?? ''}`);
  if (!isMap(doc.contents)) return null;
  const pair = doc.contents.items.find((item) => isScalar(item.key) && item.key.value === 'pages');
  if (!pair || !isScalar(pair.key) || !isSeq(pair.value)) return null;
  const seq = pair.value;
  const entries = seq.items.map((item): Entry => {
    if (!isScalar(item)) throw new MetaEditError('pages holds an entry that is not a string');
    const [start, end] = item.range;
    return { value: item.value, start, end, type: item.type };
  });
  return { seq, entries, keyEnd: pair.key.range[1], end: seq.range[1] };
}

// The entries of `pages`, or null when the file has no `pages` list (then
// fumadocs lists every page of the folder itself).
export function readPages(text: string): unknown[] | null {
  return pagesOf(text)?.entries.map((entry) => entry.value) ?? null;
}

const lineStart = (text: string, at: number) => text.lastIndexOf('\n', at - 1) + 1;
const lineEnd = (text: string, at: number) => {
  const end = text.indexOf('\n', at);
  return end === -1 ? text.length : end;
};

// Where each entry's movable text sits: its whole line in a block list, so a
// comment at the end of the line moves along; just the value in a flow list.
function spans(text: string, pages: Pages) {
  return pages.entries.map((entry) =>
    pages.seq.flow ? { start: entry.start, end: entry.end } : { start: lineStart(text, entry.start), end: lineEnd(text, entry.end) },
  );
}

function splice(text: string, edits: { start: number; end: number; text: string }[]) {
  let result = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

// `value` written the way `type` writes it; plain only when it reads back
// as the same string.
export function quote(value: string, type: Scalar.Type | undefined = Scalar.QUOTE_DOUBLE) {
  if (type === Scalar.QUOTE_SINGLE) return `'${value.replace(/'/g, "''")}'`;
  if (type === Scalar.PLAIN) {
    try {
      if (parse(value, { logLevel: 'silent' }) === value && !/^[-?:,[\]{}#&*!|>'"%@`\s]|[:#]\s|\s$/.test(value)) return value;
    } catch {
      // not plain-safe
    }
  }
  return JSON.stringify(value);
}

// Moves entry `from` so that it ends up at index `to`. The lines the
// entries sit on stay where they are and swap their text, so comment lines
// between entries do not move.
export function moveEntry(text: string, from: number, to: number) {
  const pages = pagesOf(text);
  if (!pages) throw new MetaEditError('meta.yaml has no pages list');
  const count = pages.entries.length;
  if (!(from >= 0 && from < count && to >= 0 && to < count)) throw new MetaEditError('no such entry');
  if (from === to) return text;
  const places = spans(text, pages);
  const order = places.map((_, index) => index);
  order.splice(to, 0, ...order.splice(from, 1));
  return splice(
    text,
    places.map((place, index) => {
      const source = places[order[index]];
      return { ...place, text: text.slice(source.start, source.end) };
    }),
  );
}

// Inserts `value` as entry `at` (the end when `at` is the entry count),
// written like the entry next to it. Returns null when the file has no
// `pages` list.
export function insertEntry(text: string, value: string, at: number) {
  const pages = pagesOf(text);
  if (!pages) return null;
  const { entries, seq } = pages;
  if (!(at >= 0 && at <= entries.length)) throw new MetaEditError('no such entry');
  const model = entries.length === 0 ? null : (entries[Math.min(at, entries.length - 1)]);
  const written = quote(value, model?.type);
  if (model === null) {
    // `pages: []` becomes a block list under the key.
    const keyLine = text.slice(lineStart(text, pages.keyEnd), pages.keyEnd);
    const indent = `${keyLine.slice(0, keyLine.length - keyLine.trimStart().length)}  `;
    return splice(text, [{ start: pages.keyEnd, end: pages.end, text: `:\n${indent}- ${written}` }]);
  }
  if (seq.flow) {
    const edit = at < entries.length
      ? { start: model.start, end: model.start, text: `${written}, ` }
      : { start: model.end, end: model.end, text: `, ${written}` };
    return splice(text, [edit]);
  }
  const places = spans(text, pages);
  const line = `${text.slice(lineStart(text, model.start), model.start)}${written}`;
  const place = places[Math.min(at, places.length - 1)];
  if (at < places.length) return splice(text, [{ start: place.start, end: place.start, text: `${line}\n` }]);
  return splice(text, [{ start: place.end, end: place.end, text: `\n${line}` }]);
}

// Replaces the value of entry `index`, keeping its quote style.
export function replaceEntry(text: string, index: number, value: string) {
  const entry = pagesOf(text)?.entries[index];
  if (!entry) throw new MetaEditError('no such entry');
  return splice(text, [{ start: entry.start, end: entry.end, text: quote(value, entry.type) }]);
}

// The meta.yaml of a new folder, with or without an index page. It starts
// closed in the site's sidebar unless `open`.
export function metaTemplate(title: string, pages: string[], open = false) {
  const lines = [`title: ${JSON.stringify(title)}`, `defaultOpen: ${String(open)}`];
  if (pages.length === 0) lines.push('pages: []');
  else lines.push('pages:', ...pages.map((page) => `  - ${JSON.stringify(page)}`));
  return `${lines.join('\n')}\n`;
}

// Sets `defaultOpen`: its value is replaced where it is, keeping a comment
// after it, or a line is added right after `title` (before the next key
// when the title is a block scalar; first when there is no title). New
// lines end like the file's.
export function setDefaultOpen(text: string, open: boolean) {
  return setFlag(text, 'defaultOpen', open);
}

// Sets the true/false `key` the way setDefaultOpen sets `defaultOpen`.
// `file` names the YAML in errors: a meta.yaml, or a page's frontmatter.
export function setFlag(text: string, key: string, value: boolean, file = 'meta.yaml') {
  const next = writeFlag(text, key, value, file);
  // The edit is by text: refuse a result that does not read back as asked.
  if (dataOf(next)[key] !== value) throw new MetaEditError(`could not set ${key} in this ${file}: edit it by hand`);
  return next;
}

// Removes `key` and the line it sits on (with a comment after it), and
// nothing else. A key added by setFlag comes out again byte for byte.
export function removeKey(text: string, key: string, file = 'meta.yaml') {
  const items = blockItems(text, file);
  if (items === null) return text;
  const pair = items.find((item) => isScalar(item.key) && item.key.value === key);
  if (!pair) return text;
  if (pair.value !== null && !isScalar(pair.value)) throw new MetaEditError(`${key} is not a value`);
  const start = lineStart(text, (pair.key as Scalar).range?.[0] ?? 0);
  const end = lineEnd(text, pair.value?.range[1] ?? (pair.key as Scalar).range?.[1] ?? start);
  // The last line without a newline after it takes the newline before it.
  const before = text[start - 2] === '\r' ? 2 : 1;
  const next = end < text.length ? text.slice(0, start) + text.slice(end + 1) : text.slice(0, Math.max(0, start - before));
  if (key in dataOf(next)) throw new MetaEditError(`could not remove ${key} from this ${file}: edit it by hand`);
  return next;
}

function dataOf(text: string): Record<string, unknown> {
  const data: unknown = parse(text);
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
}

// The pairs of a block map, or null for an empty document.
function blockItems(text: string, file: string) {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new MetaEditError(`${file} does not parse: ${doc.errors[0]?.message ?? ''}`);
  if (doc.contents === null) return null;
  if (!isMap(doc.contents) || doc.contents.flow) throw new MetaEditError(`${file} is not a block map`);
  return doc.contents.items;
}

function writeFlag(text: string, key: string, flag: boolean, file: string) {
  const value = String(flag);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const line = `${key}: ${value}`;
  const append = () => `${text}${text === '' || text.endsWith('\n') ? '' : eol}${line}${text === '' || text.endsWith('\n') ? eol : ''}`;
  const items = blockItems(text, file);
  if (items === null) return append();
  const at = (name: string) => items.findIndex((item) => isScalar(item.key) && item.key.value === name);
  const current = at(key);
  if (current !== -1) {
    const node = items[current].value;
    if (node !== null && !isScalar(node)) throw new MetaEditError(`${key} is not a value`);
    // `key:` with no value: write right after the colon, so the space
    // before a comment that follows stays.
    if (node === null || node.range[0] === node.range[1]) {
      const name = items[current].key as Scalar;
      const colon = text.indexOf(':', name.range?.[1] ?? 0) + 1;
      return splice(text, [{ start: colon, end: colon, text: ` ${value}` }]);
    }
    return splice(text, [{ start: node.range[0], end: node.range[1], text: value }]);
  }
  const title = at('title');
  const titleValue = title === -1 ? null : items[title].value;
  if (isScalar(titleValue) && titleValue.type !== Scalar.BLOCK_LITERAL && titleValue.type !== Scalar.BLOCK_FOLDED) {
    const end = lineEnd(text, titleValue.range[1]);
    const place = text[end - 1] === '\r' ? end - 1 : end;
    if (place === text.length) return append();
    return splice(text, [{ start: place, end: place, text: `${eol}${line}` }]);
  }
  const next = title + 1;
  if (next === items.length) return append();
  const nextKey = items[next].key;
  if (!isScalar(nextKey)) throw new MetaEditError(`${file} has a key that is not a string`);
  const start = lineStart(text, nextKey.range[0]);
  return splice(text, [{ start, end: start, text: `${line}${eol}` }]);
}

// A meta.yaml that only orders the folder's pages.
export function pagesTemplate(pages: string[]) {
  return `pages:\n${pages.map((page) => `  - ${JSON.stringify(page)}\n`).join('')}`;
}
