import { attributes } from '../source-attributes';

// `::::accordions{…}` with its `:::accordion{kind="…" title="…"}` items, as
// lib/remark-notes-directives.ts reads them. The editor keeps the whole group
// as one verbatim block; this reads it and rewrites one item's body without
// touching any other byte.

export type AccordionItem = { title: string; kind: string | undefined; body: string };
export type AccordionGroup = { items: AccordionItem[] };

type Span = { item: AccordionItem; start: number; end: number };

const OPEN = /^\s*(:{3,})([A-Za-z][\w-]*)(?:\[([^\]]*)\])?(?:\{(.*)\})?\s*$/;
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
        current = { item: { title: attrs.title ?? open.at(3) ?? 'Accordion', kind: attrs.kind, body: '' }, start: index + 1 };
      }
      fences.push(open[1].length);
    } else if (close && fences.length > 0 && close[1].length >= (fences.at(-1) ?? 0)) {
      fences.pop();
      if (fences.length === 0 && current) {
        const body = lines.slice(current.start, index).map((text) => text.replace(/\r$/, ''));
        out.push({ item: { ...current.item, body: body.join('\n') }, start: current.start, end: index });
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
