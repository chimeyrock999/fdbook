import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import { attributes } from '#plugins/source-attributes.ts';

// `::::accordions{…}` with its `:::accordion{kind="…" title="…"}` items, as
// lib/remark-notes-directives.ts reads them. The editor keeps the whole group
// as one verbatim block; this reads it and rewrites one item's body, kind or
// title without touching any other byte.

export type AccordionItem = { title: string; kind: string | undefined; body: string };
export type AccordionGroup = { items: AccordionItem[] };

// `opener` is the item's `:::accordion` line, `start`..`end` its body.
type Span = { item: AccordionItem; opener: number; start: number; end: number };

const OPEN = /^\s*(:{3,})([A-Za-z][\w-]*)(?:\[((?:\\.|[^\\\]])*)\])?(?:\{(.*)\})?\s*$/;
const CLOSE = /^\s*(:{3,})\s*$/;

function isAccordionGroup(value: string) {
  return /^:{3,}accordions\b/.test(value);
}

function spans(lines: string[]): Span[] | null {
  if (lines.length < 2 || !CLOSE.test(lines.at(-1) ?? '')) return null;
  const out: Span[] = [];
  const fences: number[] = [];
  let current: { item: AccordionItem; start: number } | null = null;
  for (let index = 1; index < lines.length - 1; index++) {
    const line = lines[index];
    const open = OPEN.exec(line);
    const close = CLOSE.exec(line);
    if (open) {
      if (fences.length === 0 && open[2] === 'accordion') {
        const attrs = attributes(open.at(4) ?? '');
        const label = open.at(3);
        const title = attrs.title === undefined ? label === undefined ? undefined : labelText(label) : decodeReferences(attrs.title);
        current = { item: { title: title ?? 'Accordion', kind: attrs.kind, body: '' }, start: index + 1 };
      }
      fences.push(open[1].length);
    } else if (close && fences.length > 0 && close[1].length >= (fences.at(-1) ?? 0)) {
      fences.pop();
      if (fences.length === 0 && current) {
        const body = lines.slice(current.start, index).map((text) => text.replace(/\r$/, ''));
        out.push({ item: { ...current.item, body: body.join('\n') }, opener: current.start - 1, start: current.start, end: index });
        current = null;
      }
    }
  }
  return fences.length === 0 ? out : null;
}

export function parseAccordions(value: string): AccordionGroup | null {
  if (!isAccordionGroup(value)) return null;
  const found = spans(value.split('\n'));
  return found ? { items: found.map((span) => span.item) } : null;
}

// The group with item `index`'s body replaced. The editor keeps the block
// without the indent of an enclosing list and adds it back on save.
export function withAccordionBody(value: string, index: number, body: string): string {
  const lines = value.split('\n');
  const span = spans(lines)?.[index];
  if (!span) throw new Error(`no accordion ${String(index)} in this group`);
  const eol = lines[0].endsWith('\r') ? '\r' : '';
  const written = body.split('\n').map((text) => text + eol);
  return [...lines.slice(0, span.start), ...written, ...lines.slice(span.end)].join('\n');
}

export type AccordionAttributes = { kind?: string; title?: string };

// The group with item `index`'s kind and/or title set. Only its opening
// line changes: an attribute keeps its place, spacing and quotes, a missing
// one is added at the end, and a title written as the `[label]` stays there.
// Values are text as the site reads it: references in an attribute and
// markdown in the label are decoded on read and written so they read back.
export function withAccordionAttributes(value: string, index: number, changes: AccordionAttributes): string {
  const lines = value.split('\n');
  const span = spans(lines)?.[index];
  const line = span && OPENER.exec(lines[span.opener]);
  if (!span || !line) throw new Error(`no accordion ${String(index)} in this group`);
  const [, head, label, braces, tail] = line as unknown as [string, string, string | undefined, string | undefined, string];
  let inner = braces?.slice(1, -1);
  let written = label;
  for (const [name, next] of Object.entries(changes) as [keyof AccordionAttributes, string | undefined][]) {
    if (next === undefined) continue;
    const current = inner === undefined ? undefined : attributes(inner)[name];
    if (name === 'title' && current === undefined && label !== undefined) {
      if (labelText(label.slice(1, -1)) !== next) written = `[${next.replace(MARKDOWN, '\\$&')}]`;
    } else if (current === undefined) {
      const added = `${name}=${quoted(next, '"')}`;
      inner = inner === undefined || inner.trim() === '' ? added : `${inner.replace(/\s*$/, '')} ${added}${/\s*$/.exec(inner)?.[0] ?? ''}`;
    } else if (decodeReferences(current) !== next) {
      inner = setAttribute(inner ?? '', name, next);
    }
  }
  lines[span.opener] = `${head}${written ?? ''}${inner === undefined ? '' : `{${inner}}`}${tail}`;
  return lines.join('\n');
}

const OPENER = /^(\s*:{3,}accordion)(\[(?:\\.|[^\\\]])*\])?(\{.*\})?(\s*)$/;
// Every attribute of a `{…}`, bare or with a value, as source-attributes.ts
// reads them.
const ATTRIBUTE = /([^\s"'=<>`{}]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`{}]+))?/g;
const BARE = /^[^\s"'=<>`{}]+$/;

// `{…}` with attribute `name`'s value replaced, in its own quotes when the
// new value allows them. The last one of a name is the one that is read.
function setAttribute(inner: string, name: string, value: string) {
  const match = [...inner.matchAll(ATTRIBUTE)].filter((found) => found[1] === name).at(-1);
  if (!match) return inner;
  const [whole, key, eq = '=', old = ''] = match as unknown as [string, string, string | undefined, string | undefined];
  const quote = old.startsWith("'") ? "'" : old.startsWith('"') || old === '' ? '"' : '';
  const written = quote === '' && BARE.test(value) && encodeReferences(value) === value ? value : quoted(value, quote || '"');
  return `${inner.slice(0, match.index)}${key}${eq}${written}${inner.slice(match.index + whole.length)}`;
}

// `value` in `quote`, or in the other quote when it holds this one; with
// both, its double quotes become `&quot;`.
function quoted(text: string, quote: string) {
  const value = encodeReferences(text);
  const other = quote === '"' ? "'" : '"';
  if (!value.includes(quote)) return `${quote}${value}${quote}`;
  if (!value.includes(other)) return `${other}${value}${other}`;
  return `"${value.replaceAll('"', '&quot;')}"`;
}

// A character reference as micromark reads one: `&name;`, `&#123;`, `&#x1F;`.
const REFERENCE = /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([A-Za-z][A-Za-z\d]{0,31}));/g;

function reference(match: string, decimal: string | undefined, hex: string | undefined, name: string | undefined) {
  if (name !== undefined) return decodeNamedCharacterReference(name) || match;
  const code = Number.parseInt(decimal ?? hex ?? '', decimal === undefined ? 16 : 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD';
}

function decodeReferences(value: string) {
  return value.replace(REFERENCE, reference);
}

// A `&` that would start a reference becomes `&amp;`, so the value reads back
// as it was typed.
function encodeReferences(value: string) {
  return value.replace(REFERENCE, (match) => `&amp;${match.slice(1)}`);
}

// The label's text: backslash escapes and references decoded (the site
// shows the label's text; other markdown in it stays as typed). Written
// back with markdown's special characters escaped.
const MARKDOWN = /[\\`*_[\]<>&~]/g;
const LABEL = /\\([!-/:-@[-`{-~])|&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([A-Za-z][A-Za-z\d]{0,31}));/g;

function labelText(label: string) {
  return label.replace(LABEL, (match, escaped: string | undefined, decimal: string | undefined, hex: string | undefined, name: string | undefined) =>
    escaped ?? reference(match, decimal, hex, name));
}
