import { describe, expect, it } from 'vitest';
import { replaceSegment, rewriteHref, rewriteLinks, type Rename } from '../../../server/tree/links';

const page: Rename = { from: 'computer-systems/operating-systems/page-cache.mdx', to: 'computer-systems/operating-systems/os-cache.mdx', folder: false };
const folder: Rename = { from: 'distributed-systems/mapreduce', to: 'distributed-systems/map-reduce', folder: true };

describe('rewriteHref', () => {
  it('follows file links next to the note', () => {
    expect(rewriteHref('./operating-systems/page-cache.mdx', 'computer-systems/index.mdx', page)).toBe('./operating-systems/os-cache.mdx');
    expect(rewriteHref('../operating-systems/page-cache.mdx#flush', 'computer-systems/storage/wal.mdx', page)).toBe('../operating-systems/os-cache.mdx#flush');
    expect(rewriteHref('./page-cache.mdx', 'computer-systems/index.mdx', page)).toBeNull();
  });

  it('follows /notes URLs and relative URLs', () => {
    expect(rewriteHref('/notes/computer-systems/operating-systems/page-cache', 'index.mdx', page)).toBe('/notes/computer-systems/operating-systems/os-cache');
    expect(rewriteHref('/notes/distributed-systems/mapreduce#yarn-components', 'a/b.mdx', folder)).toBe('/notes/distributed-systems/map-reduce#yarn-components');
    expect(rewriteHref('/notes/distributed-systems/mapreduce/mit-65840-lab01/', 'a.mdx', folder)).toBe('/notes/distributed-systems/map-reduce/mit-65840-lab01/');
    // From distributed-systems/rpc-and-threads (URL /notes/distributed-systems/rpc-and-threads).
    expect(rewriteHref('mapreduce?x=1', 'distributed-systems/rpc-and-threads.mdx', folder)).toBe('map-reduce?x=1');
    expect(rewriteHref('/notes/distributed-systems/mapreduce-two', 'a.mdx', folder)).toBeNull();
  });

  it('moves links inside a renamed folder only when they leave it and come back', () => {
    expect(rewriteHref('./mit-65840-lab01.mdx', 'distributed-systems/mapreduce/index.mdx', folder)).toBeNull();
    expect(rewriteHref('../mapreduce/mit-65840-lab01.mdx', 'distributed-systems/mapreduce/index.mdx', folder)).toBe('../map-reduce/mit-65840-lab01.mdx');
  });

  it('leaves paths under the page name alone: assets and a folder of the same name', () => {
    const post: Rename = { from: 'pr/post.mdx', to: 'pr/renamed.mdx', folder: false };
    // Assets kept in public/notes/pr/post/ are not the page.
    expect(rewriteHref('/notes/pr/post/big.jpg', 'pr/post.mdx', post)).toBeNull();
    expect(rewriteHref('/notes/pr/post', 'pr/post.mdx', post)).toBe('/notes/pr/renamed');
    expect(rewriteHref('/notes/pr/post/', 'pr/post.mdx', post)).toBe('/notes/pr/renamed/');
    // A folder pr/post/ next to the page pr/post.mdx.
    expect(rewriteHref('./post/setup.mdx', 'pr/index.mdx', post)).toBeNull();
    expect(replaceSegment(['pr'], 'post/setup', 'pr/post', 'renamed', true)).toBeNull();
    expect(replaceSegment(['pr'], 'post', 'pr/post', 'renamed', true)).toBe('renamed');
    expect(replaceSegment(['pr'], 'post/setup', 'pr/post', 'renamed')).toBe('renamed/setup');
  });

  it('leaves anchors, other sites and other pages alone', () => {
    for (const href of ['#mapreduce', 'https://research.google.com/archive/mapreduce-osdi04.pdf', '//cdn/mapreduce', 'mailto:a@b', '']) {
      expect(rewriteHref(href, 'distributed-systems/mapreduce/index.mdx', folder)).toBeNull();
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
      '[pc]: /notes/computer-systems/operating-systems/page-cache#top',
      '',
    ].join('\n');
    const { next, count } = rewriteLinks(source, 'computer-systems/index.mdx', page);
    expect(count).toBe(3);
    expect(next).toBe(
      source
        .replace('cache](./operating-systems/page-cache.mdx "Page', 'cache](./operating-systems/os-cache.mdx "Page')
        .replace('(<./operating-systems/page-cache.mdx>)', '(<./operating-systems/os-cache.mdx>)')
        .replace('[pc]: /notes/computer-systems/operating-systems/page-cache#top', '[pc]: /notes/computer-systems/operating-systems/os-cache#top'),
    );
  });

  it('leaves a note that does not parse alone', () => {
    const source = '<div>\n[x](./operating-systems/page-cache.mdx)\n';
    expect(rewriteLinks(source, 'computer-systems/index.mdx', page)).toEqual({ next: source, count: 0 });
  });
});
