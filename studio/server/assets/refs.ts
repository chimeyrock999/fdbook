import type { Nodes } from 'mdast';
import type { LeafDirective } from 'mdast-util-directive';
import type { MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx-jsx';
import { visit } from 'unist-util-visit';
import { parseNote } from '../lint/lint.ts';
import { decodeRefs, markdownRange, type Range } from '../markdown/destination.ts';
import { pageUrl } from '../lint/rules/links.ts';
import { diagramPathOf } from '@site/lib/diagram/source.ts';
import { ASSETS_DIR, classifyPath, extensionOf, isAssetExtension, publicAsset } from '../security/asset-types.ts';

// References from a note to files under public/notes, found on the parsed
// note so code blocks and the frontmatter never count. Each reference is
// resolved the way the site reads it:
// - `src` of <HtmlEmbed>, <SvgDiagram> and ::html / ::svg / ::diagram: a
//   path under public/ (lib/read-public-asset.ts). JSX takes a string or a
//   string literal in braces (`src={"…"}`), which MDX evaluates the same.
// - Markdown images that start with `/`: a URL the browser asks for, so
//   percent escapes are decoded. Relative images are imported by the MDX
//   build instead, so they are not public/ files.
// - Markdown links, link definitions and <img src>: a URL, resolved against
//   the page URL, as the browser does.
// - `src` of <Diagram>: a file under diagrams/ without its extension
//   (lib/read-diagram.ts). It is listed with the assets so a diagram shows
//   where it is used, and never rewritten: diagrams are not renamed here.

export type AssetRefKind = 'image' | 'link' | 'jsx' | 'directive' | 'diagram';

// `asset` is a worktree path (`public/notes/…`); `start`/`end` are offsets
// of the path as written, without its query or hash; line and column are
// 1-based, of `start`. Not `exact`: the path could not be placed, so
// `start` is the node's and `end` equals it.
export type AssetRef = { asset: string; kind: AssetRefKind; start: number; end: number; line: number; column: number; exact: boolean };

type Jsx = MdxJsxFlowElement | MdxJsxTextElement;

const PUBLIC_EMBEDS = ['HtmlEmbed', 'SvgDiagram'];
const PUBLIC_DIRECTIVES = ['html', 'svg', 'diagram'];
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// The file under public/ that a URL in the note at `notePath` reaches,
// decoded, or null for an anchor, another site or a scheme.
function urlAsset(href: string, notePath: string) {
  if (href === '' || href.startsWith('#') || href.startsWith('//') || SCHEME.test(href)) return null;
  try {
    return decodeURIComponent(new URL(href, `http://site${pageUrl(notePath)}`).pathname).slice(1);
  } catch {
    return null;
  }
}

// `public/notes/…` for a file the Studio manages there, else null.
function managed(asset: string | null) {
  if (asset === null || !asset.startsWith('notes/') || !isAssetExtension(extensionOf(asset))) return null;
  return `public/${asset}`;
}

// The file a <Diagram src> draws, as the site resolves it, or null when
// that is no diagram file the Studio may touch.
function diagramFile(src: string) {
  const path = diagramPathOf(src);
  return path !== null && classifyPath(path) === 'diagram' ? path : null;
}

// Where the query or hash starts; the `#` of a character reference (`&#46;`)
// is part of the path.
const pathEnd = (raw: string) => {
  const at = raw.search(/\?|(?<!&)#/);
  return at === -1 ? raw.length : at;
};

// The `src` attribute: its value (a string, or a string literal in braces,
// which MDX evaluates the same) and where it is written. Any other
// expression is code, not a path: no value.
function jsxSrc(node: Jsx, source: string): { value: string | null; range: Range | null } {
  const attribute = node.attributes.find((item) => item.type === 'mdxJsxAttribute' && item.name === 'src');
  if (attribute?.type !== 'mdxJsxAttribute' || attribute.value === null || attribute.value === undefined) return { value: null, range: null };
  const start = attribute.position?.start.offset;
  const end = attribute.position?.end.offset;
  const written = start === undefined || end === undefined ? '' : source.slice(start, end);
  if (typeof attribute.value === 'string') {
    const match = /^src\s*=\s*(["'])/.exec(written);
    if (!match || start === undefined || end === undefined) return { value: attribute.value, range: null };
    const range = { start: start + match[0].length, end: end - 1 };
    return { value: attribute.value, range: decodeRefs(source.slice(range.start, range.end)) === attribute.value ? range : null };
  }
  const match = /^src\s*=\s*\{\s*(["'])([^"'\\\n]*)\1\s*\}$/.exec(written);
  if (!match || start === undefined) return { value: null, range: null };
  const at = start + match[0].indexOf(match[1]) + 1;
  return { value: match[2], range: { start: at, end: at + match[2].length } };
}

// Skips a `[label]` from `at` (escapes and nested brackets kept), returning
// where it ends, or -1.
function skipLabel(text: string, at: number) {
  let depth = 0;
  for (let index = at; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === '\\') index += 1;
    else if (char === '[') depth += 1;
    else if (char === ']' && --depth === 0) return index + 1;
  }
  return -1;
}

// Directive attributes carry no positions. After `::name` and its label
// comes the `{…}` block; each attribute there starts after `{` or a space,
// so `src=` inside a quoted value is not one. The last `src` wins, as in
// remark-directive.
function directiveRange(node: LeafDirective, source: string): Range | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  const value = node.attributes?.src;
  if (start === undefined || end === undefined || typeof value !== 'string') return null;
  const head = source.slice(start, end);
  let at = 2 + node.name.length;
  if (head.charAt(at) === '[') at = skipLabel(head, at);
  if (at === -1 || head.charAt(at) !== '{') return null;
  let found: Range | null = null;
  at += 1;
  while (at < head.length && head.charAt(at) !== '}') {
    while (/\s/.test(head.charAt(at))) at += 1;
    const key = /^[^\s=}"']*/.exec(head.slice(at))?.[0] ?? '';
    at += key.length;
    const equals = /^\s*=\s*/.exec(head.slice(at));
    if (!equals) {
      if (key === '') at += 1;
      continue;
    }
    at += equals[0].length;
    const quote = head.charAt(at);
    let valueStart = at;
    let valueEnd: number;
    if (quote === '"' || quote === "'") {
      valueStart = at + 1;
      valueEnd = head.indexOf(quote, valueStart);
      if (valueEnd === -1) return null;
      at = valueEnd + 1;
    } else {
      valueEnd = valueStart + (/^[^\s"'<=>`}]*/.exec(head.slice(valueStart))?.[0].length ?? 0);
      at = valueEnd;
    }
    if (key === 'src') found = { start: start + valueStart, end: start + valueEnd };
  }
  return found && decodeRefs(source.slice(found.start, found.end)) === value ? found : null;
}

// A reference: what it reaches, and where its path is written (null when it
// cannot be placed exactly).
type Found = { kind: AssetRefKind; asset: string | null; range: Range | null };

function referenceOf(node: Nodes, source: string, notePath: string): Found | null {
  if (node.type === 'link' || node.type === 'definition') {
    return { kind: 'link', asset: urlAsset(node.url, notePath), range: markdownRange(node, source) };
  }
  if (node.type === 'image') {
    if (!node.url.startsWith('/') || node.url.startsWith('//')) return null;
    return { kind: 'image', asset: urlAsset(node.url, notePath), range: markdownRange(node, source) };
  }
  if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name === 'Diagram') {
    const { value, range } = jsxSrc(node, source);
    return value === null ? null : { kind: 'diagram', asset: diagramFile(value), range };
  }
  if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name) {
    if (!PUBLIC_EMBEDS.includes(node.name) && node.name !== 'img') return null;
    const { value, range } = jsxSrc(node, source);
    if (value === null) return null;
    return { kind: 'jsx', asset: node.name === 'img' ? urlAsset(value, notePath) : SCHEME.test(value) ? null : publicAsset(value), range };
  }
  if (node.type === 'leafDirective' && PUBLIC_DIRECTIVES.includes(node.name)) {
    const value = node.attributes?.src;
    if (typeof value !== 'string') return null;
    return { kind: 'directive', asset: SCHEME.test(value) ? null : publicAsset(value), range: directiveRange(node, source) };
  }
  return null;
}

function lineStarts(source: string) {
  const starts = [0];
  for (let index = source.indexOf('\n'); index !== -1; index = source.indexOf('\n', index + 1)) starts.push(index + 1);
  return starts;
}

// Every reference in the note at `notePath` (relative to content/notes) to
// a file under public/notes, in file order; null when the note does not
// parse. A reference whose path cannot be placed exactly in the source
// still counts, as not `exact`: it marks the node's start and is never
// rewritten.
export function findAssetRefs(source: string, notePath: string): AssetRef[] | null {
  let tree;
  try {
    tree = parseNote(source);
  } catch {
    return null;
  }
  const starts = lineStarts(source);
  const refs: AssetRef[] = [];
  visit(tree, (node) => {
    const found = referenceOf(node, source, notePath);
    const asset = found?.kind === 'diagram' ? found.asset : managed(found?.asset ?? null);
    if (!found || asset === null) return;
    const at = found.range?.start ?? node.position?.start.offset ?? 0;
    const end = found.range ? at + pathEnd(source.slice(at, found.range.end)) : at;
    let line = starts.length;
    while (starts[line - 1] > at) line -= 1;
    refs.push({ asset, kind: found.kind, start: at, end, line, column: at - starts[line - 1] + 1, exact: found.range !== null });
  });
  return refs.sort((a, b) => a.start - b.start);
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/'));
const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

// The path to write for a reference `raw` (as written) to an asset that
// moved from `from` to `to`. A new name in the same folder changes only the
// last segment, so relative paths stay relative; a new folder writes the
// site path, with a leading slash unless the reference had none.
function movedRaw(ref: AssetRef, raw: string, from: string, to: string) {
  const markdown = ref.kind === 'image' || ref.kind === 'link';
  const name = markdown ? encodeURIComponent(baseOf(to)) : baseOf(to);
  if (dirOf(from) === dirOf(to)) return `${raw.slice(0, raw.lastIndexOf('/') + 1)}${name}`;
  const site = `/${to.slice('public/'.length)}`;
  const path = markdown ? encodeURI(site) : site;
  return raw.startsWith(`${ASSETS_DIR.slice('public/'.length)}/`) ? path.slice(1) : path;
}

// The note with every reference to a moved asset pointed at its new place:
// `moved` maps an asset (`public/notes/…`) to where it goes, or null when it
// stays. Only the path changes; its query, hash and quotes stay as written.
// Null when the note does not parse.
// `refs`, when given, are the note's references from findAssetRefs on this
// same source, so it is not parsed again.
export function rewriteAssetRefs(
  source: string,
  notePath: string,
  moved: (asset: string) => string | null,
  refs: AssetRef[] | null = findAssetRefs(source, notePath),
): { next: string; count: number } | null {
  if (refs === null) return null;
  let next = source;
  let count = 0;
  // From the end, so earlier offsets stay true; a range that overlaps one
  // already written is skipped rather than spliced twice.
  let limit = Infinity;
  for (const ref of [...refs].sort((a, b) => b.start - a.start)) {
    const to = moved(ref.asset);
    if (!ref.exact || ref.kind === 'diagram' || to === null || to === ref.asset || ref.end > limit) continue;
    limit = ref.start;
    next = next.slice(0, ref.start) + movedRaw(ref, source.slice(ref.start, ref.end), ref.asset, to) + next.slice(ref.end);
    count += 1;
  }
  return { next, count };
}
