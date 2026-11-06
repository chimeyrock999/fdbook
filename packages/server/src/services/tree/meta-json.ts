import { MetaEditError } from './meta-edit.ts';

// The edits of meta-edit.ts for a meta.json. As there, the parsed file only
// says where each key and entry sits; the edit replaces those characters in
// the text, so the key order, the indentation (spaces or tabs), a list kept
// on one line and the final newline (or none) stay as they were.

type Span = { start: number; end: number };
type Member = Span & { key: string; value: Span };
type Container = Span & { items: Span[] };

const WHITESPACE = /[ \t\r\n]/;

function skip(text: string, at: number) {
  let index = at;
  while (index < text.length && WHITESPACE.test(text[index])) index += 1;
  return index;
}

// Where the JSON value at `at` (after whitespace) ends. The text has passed
// JSON.parse, so only strings and nesting need care.
function valueEnd(text: string, at: number): number {
  const open = text[at];
  if (open === '"') {
    let index = at + 1;
    while (text[index] !== '"') index += text[index] === '\\' ? 2 : 1;
    return index + 1;
  }
  if (open === '{' || open === '[') {
    let depth = 0;
    for (let index = at; index < text.length; index += 1) {
      const char = text[index];
      if (char === '"') index = valueEnd(text, index) - 1;
      else if (char === '{' || char === '[') depth += 1;
      else if (char === '}' || char === ']') {
        depth -= 1;
        if (depth === 0) return index + 1;
      }
    }
  }
  let index = at;
  while (index < text.length && !/[\s,\]}]/.test(text[index])) index += 1;
  return index;
}

// The values of the array or the pairs of the object that starts at `at`.
function itemsOf(text: string, at: number): Span[] {
  const end = valueEnd(text, at) - 1;
  const items: Span[] = [];
  let index = skip(text, at + 1);
  while (index < end) {
    const itemEnd = valueEnd(text, index);
    if (text[at] === '{') {
      // A pair: its key, the colon, its value.
      const valueAt = skip(text, skip(text, itemEnd) + 1);
      items.push({ start: index, end: valueEnd(text, valueAt) });
    } else items.push({ start: index, end: itemEnd });
    index = skip(text, (items.at(-1)?.end ?? end));
    if (text[index] === ',') index = skip(text, index + 1);
  }
  return items;
}

// The file's keys; throws MetaEditError when it is not a JSON object.
export function parsed(text: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new MetaEditError(`meta.json does not parse: ${(error as Error).message}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new MetaEditError('meta.json is not an object');
  return data as Record<string, unknown>;
}

function objectOf(text: string): Container & { members: Member[] } {
  parsed(text);
  const start = skip(text, 0);
  const members = itemsOf(text, start).map((pair): Member => {
    const keyEnd = valueEnd(text, pair.start);
    const valueAt = skip(text, skip(text, keyEnd) + 1);
    return { ...pair, key: JSON.parse(text.slice(pair.start, keyEnd)) as string, value: { start: valueAt, end: pair.end } };
  });
  return { start, end: valueEnd(text, start), items: members, members };
}

function pagesOf(text: string): Container | null {
  const member = objectOf(text).members.find((each) => each.key === 'pages');
  if (!member || text[member.value.start] !== '[') return null;
  return { ...member.value, items: itemsOf(text, member.value.start) };
}

function splice(text: string, edits: { start: number; end: number; text: string }[]) {
  let result = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}

const lineStart = (text: string, at: number) => text.lastIndexOf('\n', at - 1) + 1;
const indentAt = (text: string, at: number) => /^[ \t]*/.exec(text.slice(lineStart(text, at), at))?.[0] ?? '';
const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');

// One step of the file's indentation: the first indented line's, else two spaces.
function indentUnit(text: string) {
  return /\n([ \t]+)\S/.exec(text)?.[1] ?? '  ';
}

// What goes between two items of `container`: what the file has between
// its first two, else a comma and a new line at the first one's indentation
// when it sits on its own line, else a comma and a space.
function separator(text: string, container: Container) {
  const { items } = container;
  if (items.length > 1) return text.slice(items[0].end, items[1].start);
  const first = items[0] as Span | undefined;
  if (first !== undefined && text.slice(container.start + 1, first.start).includes('\n')) return `,${eolOf(text)}${indentAt(text, first.start)}`;
  return ', ';
}

// The entries of `pages`, or null when the file has no `pages` list.
export function readPages(text: string): unknown[] | null {
  const pages = parsed(text).pages;
  return Array.isArray(pages) ? (pages as unknown[]) : null;
}

const entriesOf = (text: string) => {
  const pages = pagesOf(text);
  if (!pages) throw new MetaEditError('meta.json has no pages list');
  return pages;
};

// Moves entry `from` to index `to`: the places stay, their texts swap.
export function moveEntry(text: string, from: number, to: number) {
  const { items } = entriesOf(text);
  if (!(from >= 0 && from < items.length && to >= 0 && to < items.length)) throw new MetaEditError('no such entry');
  if (from === to) return text;
  const order = items.map((_, index) => index);
  order.splice(to, 0, ...order.splice(from, 1));
  return splice(text, items.map((place, index) => ({ ...place, text: text.slice(items[order[index]].start, items[order[index]].end) })));
}

// Inserts `value` as entry `at` (the end when `at` is the entry count),
// set apart like the entries already there. Null without a `pages` list.
export function insertEntry(text: string, value: string, at: number) {
  const pages = pagesOf(text);
  if (!pages) return null;
  const { items } = pages;
  if (!(at >= 0 && at <= items.length)) throw new MetaEditError('no such entry');
  const written = JSON.stringify(value);
  if (items.length === 0) {
    // `[]` opens on its own lines when the object's keys sit on theirs.
    const object = objectOf(text);
    const first = object.members[0];
    if (!text.slice(object.start + 1, first.start).includes('\n')) return splice(text, [{ start: pages.start, end: pages.end, text: `[${written}]` }]);
    const indent = indentAt(text, pages.start);
    const eol = eolOf(text);
    return splice(text, [{ start: pages.start, end: pages.end, text: `[${eol}${indent}${indentUnit(text)}${written}${eol}${indent}]` }]);
  }
  const between = separator(text, pages);
  if (at < items.length) return splice(text, [{ start: items[at].start, end: items[at].start, text: `${written}${between}` }]);
  const last = items[items.length - 1];
  return splice(text, [{ start: last.end, end: last.end, text: `${between}${written}` }]);
}

// Replaces the value of entry `index`.
export function replaceEntry(text: string, index: number, value: string) {
  const entry = pagesOf(text)?.items[index];
  if (!entry) throw new MetaEditError('no such entry');
  return splice(text, [{ ...entry, text: JSON.stringify(value) }]);
}

// Keeps only the entries `keep` says yes to, set apart as before. With none
// left, `[]`.
export function keepEntries(text: string, keep: (value: unknown) => boolean) {
  const pages = pagesOf(text);
  if (!pages) return text;
  const values = pages.items.map((item): unknown => JSON.parse(text.slice(item.start, item.end)));
  const kept = pages.items.filter((_, index) => keep(values[index]));
  if (kept.length === pages.items.length) return text;
  if (kept.length === 0) return splice(text, [{ start: pages.start, end: pages.end, text: '[]' }]);
  const between = separator(text, pages);
  const first = pages.items[0];
  const last = pages.items[pages.items.length - 1];
  return splice(text, [{ start: first.start, end: last.end, text: kept.map((item) => text.slice(item.start, item.end)).join(between) }]);
}

// Sets the true/false `key`: its value is replaced where it is, or a key is
// added right after `title` (first when there is none).
export function setFlag(text: string, key: string, value: boolean) {
  const object = objectOf(text);
  const current = object.members.find((member) => member.key === key);
  if (current) {
    if (/^[{[]/.test(text[current.value.start])) throw new MetaEditError(`${key} is not a value`);
    return splice(text, [{ ...current.value, text: String(value) }]);
  }
  const pair = `${JSON.stringify(key)}: ${String(value)}`;
  if (object.members.length === 0) return splice(text, [{ start: object.start + 1, end: object.end - 1, text: ` ${pair} ` }]);
  const between = separator(text, object);
  const title = object.members.find((member) => member.key === 'title');
  if (title) return splice(text, [{ start: title.end, end: title.end, text: `${between}${pair}` }]);
  const first = object.members[0];
  return splice(text, [{ start: first.start, end: first.start, text: `${pair}${between}` }]);
}

// Removes `key` and what sets it apart from its neighbour, and nothing else.
// A key setFlag added next to others comes out again byte for byte.
export function removeKey(text: string, key: string) {
  const { members, start, end } = objectOf(text);
  const at = members.findIndex((member) => member.key === key);
  if (at === -1) return text;
  const member = members[at];
  if (members.length === 1) return splice(text, [{ start: start + 1, end: end - 1, text: '' }]);
  const next = members[at + 1] as Member | undefined;
  if (next) return splice(text, [{ start: member.start, end: next.start, text: '' }]);
  return splice(text, [{ start: members[at - 1].end, end: member.end, text: '' }]);
}

// The meta.json of a new file, as fumadocs writes them: two spaces, a final newline.
const written = (data: Record<string, unknown>) => `${JSON.stringify(data, null, 2)}\n`;

// The meta.json of a new folder, with or without an index page. It starts
// closed in the site's sidebar unless `open`.
export function metaTemplate(title: string, pages: string[], open = false) {
  return written({ title, defaultOpen: open, pages });
}

// A meta.json that only orders the folder's pages.
export function pagesTemplate(pages: string[]) {
  return written({ pages });
}

// The meta.json that hides a folder which had none.
export function hiddenTemplate(pages: string[]) {
  return written({ visible: false, pages });
}
