import type { Definition, Image, Link, Nodes } from 'mdast';
import type { LeafDirective } from 'mdast-util-directive';
import type { MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx-jsx';
import { visit } from 'unist-util-visit';
import { parseNote } from '../lint/lint.ts';
import { pageUrl } from '../lint/rules/links.ts';
import { ASSET_TYPES, ASSETS_DIR, extensionOf, publicAsset } from '../security/asset-types.ts';

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

export type AssetRefKind = 'image' | 'link' | 'jsx' | 'directive';

// `asset` is a worktree path (`public/notes/…`); `start`/`end` are offsets
// of the path as written, without its query or hash; line and column are
// 1-based, of `start`.
export type AssetRef = { asset: string; kind: AssetRefKind; start: number; end: number; line: number; column: number };

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
  if (asset === null || !asset.startsWith('notes/') || !(extensionOf(asset) in ASSET_TYPES)) return null;
  return `public/${asset}`;
}

const unescapeMarkdown = (raw: string) => raw.replace(/\\([!-/:-@[-`{-~])/g, '$1');
const pathEnd = (raw: string) => (raw.search(/[?#]/) === -1 ? raw.length : raw.search(/[?#]/));

// The destination of a link, image or definition as written, between
// `start` and `end`, or null. `marker` is what comes right before it.
function destinationAt(source: string, at: number, end: number) {
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
// definition) whose destination reads as the node's URL. An alt text or
// label may hold `](` itself, so each candidate is checked.
function markdownRange(node: Link | Image | Definition, source: string) {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return null;
  const marker = node.type === 'definition' ? ']:' : '](';
  for (let at = source.indexOf(marker, start); at !== -1 && at < end; at = source.indexOf(marker, at + 1)) {
    const range = destinationAt(source, at + 2, end);
    if (range && unescapeMarkdown(source.slice(range.start, range.end)) === node.url) return range;
  }
  return null;
}

// The value of a `src` attribute as written: a string, or a string literal
// in braces. Any other expression is code, not a path to rewrite.
function jsxRange(node: Jsx, source: string) {
  const attribute = node.attributes.find((item) => item.type === 'mdxJsxAttribute' && item.name === 'src');
  if (attribute?.type !== 'mdxJsxAttribute' || attribute.value === null || attribute.value === undefined) return null;
  const start = attribute.position?.start.offset;
  const end = attribute.position?.end.offset;
  if (start === undefined || end === undefined) return null;
  const written = source.slice(start, end);
  if (typeof attribute.value === 'string') {
    const match = /^src\s*=\s*(["'])/.exec(written);
    if (!match) return null;
    const range = { start: start + match[0].length, end: end - 1 };
    return source.slice(range.start, range.end) === attribute.value ? range : null;
  }
  const match = /^src\s*=\s*\{\s*(["'])([^"'\\\n]*)\1\s*\}$/.exec(written);
  if (!match) return null;
  const raw = match[2];
  const at = start + match[0].indexOf(match[1]) + 1;
  return { start: at, end: at + raw.length };
}

// Directive attributes carry no positions: find `src=` in the attribute
// block on the directive's first line.
function directiveRange(node: LeafDirective, source: string) {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  const value = node.attributes?.src;
  if (start === undefined || end === undefined || typeof value !== 'string') return null;
  const head = source.slice(start, end);
  const open = head.indexOf('{');
  if (open === -1) return null;
  const match = /[{\s]src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<=>`}]+))/.exec(head.slice(open));
  if (!match) return null;
  // Groups that did not take part are undefined, which the types leave out.
  const [whole, double, single, bare] = match as unknown as [string, string | undefined, string | undefined, string | undefined];
  const raw = double ?? single ?? bare ?? '';
  if (raw !== value) return null;
  const at = start + open + match.index + whole.length - raw.length - (bare === undefined ? 1 : 0);
  return { start: at, end: at + raw.length };
}

type Found = { kind: AssetRefKind; asset: string | null; start: number; end: number };

function referenceOf(node: Nodes, source: string, notePath: string): Found | null {
  if (node.type === 'link' || node.type === 'definition') {
    const range = markdownRange(node, source);
    return range && { kind: 'link', asset: urlAsset(node.url, notePath), ...range };
  }
  if (node.type === 'image') {
    if (!node.url.startsWith('/') || node.url.startsWith('//')) return null;
    const range = markdownRange(node, source);
    return range && { kind: 'image', asset: urlAsset(node.url, notePath), ...range };
  }
  if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name) {
    if (!PUBLIC_EMBEDS.includes(node.name) && node.name !== 'img') return null;
    const range = jsxRange(node, source);
    if (!range) return null;
    const src = source.slice(range.start, range.end);
    return { kind: 'jsx', asset: node.name === 'img' ? urlAsset(src, notePath) : SCHEME.test(src) ? null : publicAsset(src), ...range };
  }
  if (node.type === 'leafDirective' && PUBLIC_DIRECTIVES.includes(node.name)) {
    const range = directiveRange(node, source);
    const src = range && source.slice(range.start, range.end);
    return range && src !== null ? { kind: 'directive', asset: SCHEME.test(src) ? null : publicAsset(src), ...range } : null;
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
// parse.
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
    if (!found) return;
    const end = found.start + pathEnd(source.slice(found.start, found.end));
    const asset = managed(found.asset);
    if (asset === null) return;
    let line = starts.length;
    while (starts[line - 1] > found.start) line -= 1;
    refs.push({ asset, kind: found.kind, start: found.start, end, line, column: found.start - starts[line - 1] + 1 });
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
  for (const ref of [...refs].reverse()) {
    const to = moved(ref.asset);
    if (to === null || to === ref.asset) continue;
    next = next.slice(0, ref.start) + movedRaw(ref, source.slice(ref.start, ref.end), ref.asset, to) + next.slice(ref.end);
    count += 1;
  }
  return { next, count };
}
