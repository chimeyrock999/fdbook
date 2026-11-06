import { describe, expect, it } from 'vitest';
import { knownTargets, replaceSegment, rewriteHref, rewriteLinks, type Rename } from '../../../server/tree/links';

const page: Rename = { from: 'computer-systems/operating-systems/page-cache.mdx', to: 'computer-systems/operating-systems/os-cache.mdx', folder: false };
const folder: Rename = { from: 'distributed-systems/mapreduce', to: 'distributed-systems/map-reduce', folder: true };

// The notes the links may reach.
const known = knownTargets([
  'index.mdx',
  'computer-systems/index.mdx',
  'computer-systems/operating-systems/page-cache.mdx',
  'computer-systems/storage/wal.mdx',
  'distributed-systems/rpc-and-threads.mdx',
  'distributed-systems/mapreduce/index.mdx',
  'distributed-systems/mapreduce/mit-65840-lab01.mdx',
  'data-modeling/index.mdx',
  'data-modeling/dimensional.mdx',
  'pr/index.mdx',
  'pr/post.mdx',
  'pr/post/setup.mdx',
]);

describe('rewriteHref', () => {
  it('follows file links next to the note', () => {
    expect(rewriteHref('./operating-systems/page-cache.mdx', 'computer-systems/index.mdx', page, known)).toBe('./operating-systems/os-cache.mdx');
    expect(rewriteHref('../operating-systems/page-cache.mdx#flush', 'computer-systems/storage/wal.mdx', page, known)).toBe('../operating-systems/os-cache.mdx#flush');
    expect(rewriteHref('./page-cache.mdx', 'computer-systems/index.mdx', page, known)).toBeNull();
  });

  it('follows /docs URLs and relative URLs', () => {
    expect(rewriteHref('/docs/computer-systems/operating-systems/page-cache', 'index.mdx', page, known)).toBe('/docs/computer-systems/operating-systems/os-cache');
    expect(rewriteHref('/docs/distributed-systems/mapreduce#yarn-components', 'a/b.mdx', folder, known)).toBe('/docs/distributed-systems/map-reduce#yarn-components');
    expect(rewriteHref('/docs/distributed-systems/mapreduce/mit-65840-lab01/', 'a.mdx', folder, known)).toBe('/docs/distributed-systems/map-reduce/mit-65840-lab01/');
    // From distributed-systems/rpc-and-threads (URL /docs/distributed-systems/rpc-and-threads).
    expect(rewriteHref('mapreduce?x=1', 'distributed-systems/rpc-and-threads.mdx', folder, known)).toBe('map-reduce?x=1');
    expect(rewriteHref('/docs/distributed-systems/mapreduce-two', 'a.mdx', folder, known)).toBeNull();
  });

  it('moves links inside a renamed folder only when they leave it and come back', () => {
    expect(rewriteHref('./mit-65840-lab01.mdx', 'distributed-systems/mapreduce/index.mdx', folder, known)).toBeNull();
    expect(rewriteHref('../mapreduce/mit-65840-lab01.mdx', 'distributed-systems/mapreduce/index.mdx', folder, known)).toBe('../map-reduce/mit-65840-lab01.mdx');
  });

  it('leaves paths under the page name alone: assets and a folder of the same name', () => {
    const post: Rename = { from: 'pr/post.mdx', to: 'pr/renamed.mdx', folder: false };
    // Assets kept in public/docs/pr/post/ are not the page.
    expect(rewriteHref('/docs/pr/post/big.jpg', 'pr/post.mdx', post, known)).toBeNull();
    expect(rewriteHref('/docs/pr/post', 'pr/post.mdx', post, known)).toBe('/docs/pr/renamed');
    expect(rewriteHref('/docs/pr/post/', 'pr/post.mdx', post, known)).toBe('/docs/pr/renamed/');
    // A folder pr/post/ next to the page pr/post.mdx.
    expect(rewriteHref('./post/setup.mdx', 'pr/index.mdx', post, known)).toBeNull();
    expect(replaceSegment(['pr'], 'post/setup', 'pr/post', 'renamed', true)).toBeNull();
    expect(replaceSegment(['pr'], 'post', 'pr/post', 'renamed', true)).toBe('renamed');
    expect(replaceSegment(['pr'], 'post/setup', 'pr/post', 'renamed')).toBe('renamed/setup');
  });

  it('leaves assets under a renamed folder alone: they do not move', () => {
    const modeling: Rename = { from: 'data-modeling', to: 'data-modeling-2', folder: true };
    const source = [
      'See [pdf](/docs/data-modeling/spec.pdf) and ![x][img] and ![y](/docs/data-modeling/a.png),',
      'and [the page](/docs/data-modeling/dimensional) and [./ link](./data-modeling/dimensional.mdx).',
      '',
      '[img]: /docs/data-modeling/b.png',
      '',
    ].join('\n');
    const { next, count } = rewriteLinks(source, 'index.mdx', modeling, known);
    expect(count).toBe(2);
    expect(next).toBe(
      source
        .replace('(/docs/data-modeling/dimensional)', '(/docs/data-modeling-2/dimensional)')
        .replace('(./data-modeling/dimensional.mdx)', '(./data-modeling-2/dimensional.mdx)'),
    );
  });

  it('leaves anchors, other sites and other pages alone', () => {
    for (const href of ['#mapreduce', 'https://research.google.com/archive/mapreduce-osdi04.pdf', '//cdn/mapreduce', 'mailto:a@b', '']) {
      expect(rewriteHref(href, 'distributed-systems/mapreduce/index.mdx', folder, known)).toBeNull();
    }
  });
});

describe('rewriteLinks', () => {
  it('rewrites only the destination, keeping titles, escapes and angle brackets', () => {
    const source = [
      '---',
      'title: "[x](./operating-systems/page-cache.mdx)"',
      '---',
      '',
      'See [the [page] cache](./operating-systems/page-cache.mdx "Page cache") and',
      '[again](<./operating-systems/page-cache.mdx>), [ref][pc], [other](./storage/wal.mdx).',
      '',
      '[pc]: /docs/computer-systems/operating-systems/page-cache#top',
      '',
    ].join('\n');
    const { next, count } = rewriteLinks(source, 'computer-systems/index.mdx', page, known);
    expect(count).toBe(3);
    expect(next).toBe(
      source
        .replace('cache](./operating-systems/page-cache.mdx "Page', 'cache](./operating-systems/os-cache.mdx "Page')
        .replace('(<./operating-systems/page-cache.mdx>)', '(<./operating-systems/os-cache.mdx>)')
        .replace('[pc]: /docs/computer-systems/operating-systems/page-cache#top', '[pc]: /docs/computer-systems/operating-systems/os-cache#top'),
    );
  });

  it('reads destinations with angle brackets, escapes and nested parentheses whole', () => {
    const odd = knownTargets(['index.mdx', 'storage/x y.mdx', 'storage/x)y.mdx', 'storage/x(1).mdx']);
    const cases: [string, string, string][] = [
      ['storage/x y.mdx', '[a](<./storage/x y.mdx>)', '[a](<./storage/x-y.mdx>)'],
      ['storage/x)y.mdx', '[a](./storage/x\\)y.mdx)', '[a](./storage/x-y.mdx)'],
      ['storage/x(1).mdx', '[a](./storage/x(1).mdx)', '[a](./storage/x-y.mdx)'],
    ];
    for (const [from, source, expected] of cases) {
      const rename: Rename = { from, to: 'storage/x-y.mdx', folder: false };
      expect(rewriteLinks(`${source}\n`, 'index.mdx', rename, odd)).toEqual({ next: `${expected}\n`, count: 1 });
    }
  });

  it('leaves a note that does not parse alone', () => {
    const source = '<div>\n[x](./operating-systems/page-cache.mdx)\n';
    expect(rewriteLinks(source, 'computer-systems/index.mdx', page, known)).toEqual({ next: source, count: 0 });
  });
});
