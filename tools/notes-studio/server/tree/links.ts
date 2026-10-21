import type { Definition, Link } from 'mdast';
import { visit } from 'unist-util-visit';
import { parseNote } from '../lint/lint.ts';
import { joinPath, pageUrl } from '../lint/rules/links.ts';

// A page or folder that gets a new name in the same folder. Paths are
// relative to content/notes: `guide/intro.mdx` for a page, `guide` for a
// folder.
export type Rename = { from: string; to: string; folder: boolean };

// The notes before the rename, and their URLs: only an href that reaches one
// of them is rewritten. Anything else under the renamed path (an asset in
// public/notes/<path>/, which does not move) keeps its href.
export type Known = { pages: ReadonlySet<string>; urls: ReadonlySet<string> };

export function knownTargets(pages: Iterable<string>): Known {
  const set = new Set(pages);
  return { pages: set, urls: new Set([...set].map(pageUrl)) };
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const dirSegments = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')).split('/') : []);

function decode(segment: string) {
  const unescaped = segment.replace(/\\(.)/g, '$1');
  try {
    return decodeURIComponent(unescaped);
  } catch {
    return unescaped;
  }
}

// Walks `path` from the directory `start` the way fumadocs' joinPath does
// (`..` pops, `.` and empty segments are skipped). When a segment lands
// exactly on `target`, that segment is swapped for `name` and the new path
// is returned; null when the walk never reaches `target`. Only the one
// segment changes, so the rest of the text (escapes, `./`) stays as written.
// With `whole`, the path must end at `target` (a page): `guide/intro/a.png`
// does not point at the page `guide/intro`.
export function replaceSegment(start: string[], path: string, target: string, name: string, whole = false): string | null {
  const segments = path.split('/');
  const current = [...start];
  for (const [index, segment] of segments.entries()) {
    const value = decode(segment);
    if (value === '..') current.pop();
    else if (value !== '' && value !== '.') {
      current.push(value);
      if (current.join('/') === target) {
        if (whole && segments.slice(index + 1).some((rest) => !['', '.'].includes(decode(rest)))) return null;
        segments[index] = name;
        return segments.join('/');
      }
    }
  }
  return null;
}

function urlPath(path: string, notePath: string) {
  try {
    const pathname = decodeURIComponent(new URL(path, `http://site${pageUrl(notePath)}`).pathname);
    return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  } catch {
    return null;
  }
}

// The href with the renamed page or folder swapped in, or null when it does
// not reach a note there. Follows the lint's link rule
// (server/lint/rules/links.ts): `./` and `../` are first files next to the
// note, then like any other relative href a URL resolved against the page
// URL. `notePath` is the note's path before the rename.
export function rewriteHref(href: string, notePath: string, rename: Rename, known: Known): string | null {
  if (href === '' || href.startsWith('#') || href.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  const suffix = cut === -1 ? '' : href.slice(cut);
  const name = baseName(rename.to);
  const withSuffix = (next: string | null) => (next === null ? null : next + suffix);

  if (path.startsWith('./') || path.startsWith('../')) {
    const file = known.pages.has(joinPath(dirSegments(notePath).join('/'), decode(path)))
      ? replaceSegment(dirSegments(notePath), path, rename.from, name, !rename.folder)
      : null;
    if (file !== null) return file + suffix;
  }
  const fromUrl = (rename.folder ? `/notes/${rename.from}` : pageUrl(rename.from)).slice(1);
  const toName = rename.folder ? name : name.replace(/\.mdx$/, '');
  const target = urlPath(path, notePath);
  if (target === null || !known.urls.has(target)) return null;
  const urlDir = pageUrl(notePath).slice(1).split('/').slice(0, -1);
  return withSuffix(replaceSegment(path.startsWith('/') ? [] : urlDir, path, fromUrl, toName, !rename.folder));
}

// Where the destination of a link or definition sits in the source.
function destinationOf(node: Link | Definition, source: string): { start: number; end: number } | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return null;
  let at: number;
  if (node.type === 'link') {
    const last = node.children.at(-1)?.position?.end.offset ?? start + 1;
    at = source.indexOf('](', last);
    if (at === -1 || at >= end) return null; // an autolink: no destination of its own
    at += 2;
  } else {
    at = source.indexOf(']:', start);
    if (at === -1 || at >= end) return null;
    at += 2;
  }
  while (at < end && /\s/.test(source.charAt(at))) at += 1;
  if (source.charAt(at) === '<') {
    const close = source.indexOf('>', at);
    return close === -1 || close > end ? null : { start: at + 1, end: close };
  }
  let stop = at;
  while (stop < end && !/[\s)]/.test(source.charAt(stop))) stop += 1;
  return { start: at, end: stop };
}

// The note with every Markdown link and link definition to the renamed page
// or folder pointed at its new name, and how many changed. Only the changed
// segment of each destination is rewritten; a note that does not parse is
// left alone.
export function rewriteLinks(source: string, notePath: string, rename: Rename, known: Known): { next: string; count: number } {
  let tree;
  try {
    tree = parseNote(source);
  } catch {
    return { next: source, count: 0 };
  }
  const edits: { start: number; end: number; text: string }[] = [];
  visit(tree, (node) => {
    if (node.type !== 'link' && node.type !== 'definition') return;
    const range = destinationOf(node, source);
    if (!range) return;
    const next = rewriteHref(source.slice(range.start, range.end), notePath, rename, known);
    if (next !== null) edits.push({ ...range, text: next });
  });
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return { next: result, count: edits.length };
}
