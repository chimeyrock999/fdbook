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

// Why `href` from the note at `context.path` reaches no page, or null when it
// does (or reaches a file under public/notes). Follows source.resolveHref
// (app/notes/[[...slug]]/page.tsx): `./` and `../` are first looked up as
// files next to the note; anything else that is relative is left to the
// browser, against the page URL. A link to an `.mdx` file only works through
// the file lookup.
export function brokenLink(href: string, context: LintContext, urls: ReadonlySet<string>): string | null {
  if (href === '' || href.startsWith('#') || href.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  const [value = ''] = href.split('#');
  if (value.startsWith('./') || value.startsWith('../')) {
    const directory = context.path.includes('/') ? context.path.slice(0, context.path.lastIndexOf('/')) : '';
    const file = joinPath(directory, decode(value, decodeURI));
    if (context.pages.has(file)) return null;
    if (file.endsWith('.mdx')) return `There is no note at \`content/notes/${file}\`.`;
  }
  const target = trimSlash(decode(new URL(href, `http://site${pageUrl(context.path)}`).pathname, decodeURIComponent));
  if (target !== BASE && !target.startsWith(`${BASE}/`)) return null;
  if (urls.has(target) || context.assetExists(target.slice(1))) return null;
  return value.startsWith('/') ? 'No note has that URL.' : `It resolves to \`${target}\`, which no note has.`;
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
