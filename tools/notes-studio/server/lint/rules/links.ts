import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';
import { pointOf, type LintContext, type Report } from '../types.ts';

const BASE = '/notes';

// The URL fumadocs gives a note: `guide/index.mdx` is /notes/guide.
export function pageUrl(path: string) {
  const slugs = path.replace(/\.mdx$/, '').split('/');
  if (slugs.at(-1) === 'index') slugs.pop();
  return slugs.length > 0 ? `${BASE}/${slugs.join('/')}` : BASE;
}

// fumadocs' joinPath: `..` above the root is dropped, not an error.
export function joinPath(...paths: string[]) {
  const out: string[] = [];
  for (const path of paths) {
    for (const segment of path.split('/')) {
      if (segment === '..') out.pop();
      else if (segment !== '' && segment !== '.') out.push(segment);
    }
  }
  return out.join('/');
}

function decode(value: string, decoder: (value: string) => string) {
  try {
    return decoder(value);
  } catch {
    return value;
  }
}

function trimSlash(pathname: string) {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

// Where `href` from the note at `from` (relative to content/notes) leads,
// as source.resolveHref does (app/notes/[[...slug]]/page.tsx): `./` and
// `../` are first looked up as files next to the note (`page`, or `missing`
// for an `.mdx` file that is not there, which only that lookup reaches);
// anything else that is relative is left to the browser, against the page
// URL (`url`, a path under /notes). Null for what leaves the notes: another
// scheme, `//`, an anchor, an empty href, a URL outside /notes.
export function resolveHref(href: string, from: string, pages: ReadonlySet<string>): { page: string } | { missing: string } | { url: string } | null {
  if (href === '' || href.startsWith('#') || href.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  const [value = ''] = href.split('#');
  if (value.startsWith('./') || value.startsWith('../')) {
    const directory = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    const file = joinPath(directory, decode(value, decodeURI));
    if (pages.has(file)) return { page: file };
    if (file.endsWith('.mdx')) return { missing: file };
  }
  const target = trimSlash(decode(new URL(href, `http://site${pageUrl(from)}`).pathname, decodeURIComponent));
  return target === BASE || target.startsWith(`${BASE}/`) ? { url: target } : null;
}

// Why `href` from the note at `context.path` reaches no page, or null when it
// does (or reaches a file under public/notes).
export function brokenLink(href: string, context: LintContext, urls: ReadonlySet<string>): string | null {
  const resolved = resolveHref(href, context.path, context.pages);
  if (resolved === null || 'page' in resolved) return null;
  if ('missing' in resolved) return `There is no note at \`content/notes/${resolved.missing}\`.`;
  if (urls.has(resolved.url) || context.assetExists(resolved.url.slice(1))) return null;
  return href.startsWith('/') ? 'No note has that URL.' : `It resolves to \`${resolved.url}\`, which no note has.`;
}

// Markdown links and link definitions that reach no page.
export function checkLinks(tree: Root, context: LintContext, report: Report) {
  const urls = new Set([...context.pages].map(pageUrl));
  visit(tree, (node) => {
    if (node.type !== 'link' && node.type !== 'definition') return;
    const reason = brokenLink(node.url, context, urls);
    if (reason === null || !node.position) return;
    report({
      rule: 'link-broken',
      severity: 'error',
      message: `Link \`${node.url}\` does not reach a page. ${reason}`,
      start: pointOf(node.position.start),
      end: pointOf(node.position.end),
    });
  });
}
