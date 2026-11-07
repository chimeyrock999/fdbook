import type { Definition, Image, Link } from 'mdast';

// Where a Markdown link, image or link definition writes its destination,
// shared by page rename (services/tree/links.ts) and asset references
// (services/assets/refs.ts) so both read a destination the same way.

const unescapeMarkdown = (raw: string) => raw.replace(/\\([!-/:-@[-`{-~])/g, '$1');

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// Numeric character references and the few named ones a path may need. A
// path written with any other name does not read as the node's URL, so it
// is not placed, never guessed at.
export function decodeRefs(raw: string) {
  return raw.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[name.toLowerCase()] ?? whole;
  });
}

export type Range = { start: number; end: number };

// The destination of a link, image or definition as written, from `at`,
// or null.
function destinationAt(source: string, at: number, end: number): Range | null {
  while (at < end && /\s/.test(source.charAt(at))) at += 1;
  if (source.charAt(at) === '<') {
    const close = source.indexOf('>', at);
    return close === -1 || close > end ? null : { start: at + 1, end: close };
  }
  let stop = at;
  let depth = 0;
  while (stop < end) {
    const char = source.charAt(stop);
    if (char === '\\') stop += 1;
    else if (char === '(') depth += 1;
    else if (char === ')' && depth-- === 0) break;
    else if (/\s/.test(char)) break;
    stop += 1;
  }
  return { start: at, end: Math.min(stop, end) };
}

// Where the destination of `node` sits: the first `](` (or `]:` for a
// definition) whose destination reads as the node's URL. A link's own
// destination comes after its text, which may hold an image with the same
// URL, so the search starts after the last child; an alt text or label may
// hold `](` itself, so each candidate is checked.
export function markdownRange(node: Link | Image | Definition, source: string): Range | null {
  const start = node.type === 'link' ? (node.children.at(-1)?.position?.end.offset ?? node.position?.start.offset) : node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return null;
  const marker = node.type === 'definition' ? ']:' : '](';
  for (let at = source.indexOf(marker, start); at !== -1 && at < end; at = source.indexOf(marker, at + 1)) {
    const range = destinationAt(source, at + 2, end);
    if (range && decodeRefs(unescapeMarkdown(source.slice(range.start, range.end))) === node.url) return range;
  }
  return null;
}
