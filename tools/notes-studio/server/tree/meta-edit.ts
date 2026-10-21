import { isMap, isScalar, isSeq, parse, parseDocument, Scalar, type YAMLSeq } from 'yaml';

// Edits to the `pages` list of a meta.yaml. The YAML document only says
// where each entry sits; the edit itself replaces those characters in the
// text, so everything else (comments, blank lines, `icon`, `visible`, quote
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

// A new meta.yaml, written like obsidian-plugin's serializeMetaYaml.
export function metaTemplate(title: string, pages: string[]) {
  const lines = [`title: ${JSON.stringify(title)}`, 'defaultOpen: true'];
  if (pages.length === 0) lines.push('pages: []');
  else lines.push('pages:', ...pages.map((page) => `  - ${JSON.stringify(page)}`));
  return `${lines.join('\n')}\n`;
}
