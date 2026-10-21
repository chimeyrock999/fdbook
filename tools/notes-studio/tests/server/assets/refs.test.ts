import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findAssetRefs, rewriteAssetRefs } from '../../../server/assets/refs';
import { repoRoot } from '../../../server/config';
import { realNotes } from '../../support/notes';

const NOTE = `---
title: Demo
cover: /notes/guide/a.png
---

![A diagram](/notes/guide/a.png)

![Relative, imported by MDX](./a.png)

See [the PDF](/notes/guide/spec.pdf#page=2) and [ref][spec].

[spec]: </notes/guide/spec.pdf>

<HtmlEmbed
  title="Flow"
  src="/notes/guide/flow.html?embed=1"
/>

<SvgDiagram src="notes/guide/b.svg" />

<img src="/notes/guide/a.png" alt="" />

::html{src="/notes/guide/flow.html?embed=1" title="Flow"}

::diagram{#d src=/notes/guide/b.svg}

[A page](/notes/guide) · [Elsewhere](https://example.com/notes/guide/a.png) · <HtmlEmbed src={dynamic} />
`;

const at = (source: string, line: number) => source.split('\n')[line - 1];

describe('findAssetRefs', () => {
  it('finds every kind of reference to a file under public/notes, by line', () => {
    const refs = findAssetRefs(NOTE, 'guide/intro.mdx');
    expect(refs?.map(({ asset, kind, line }) => [asset, kind, line])).toEqual([
      ['public/notes/guide/a.png', 'image', 6],
      ['public/notes/guide/spec.pdf', 'link', 10],
      ['public/notes/guide/spec.pdf', 'link', 12],
      ['public/notes/guide/flow.html', 'jsx', 16],
      ['public/notes/guide/b.svg', 'jsx', 19],
      ['public/notes/guide/a.png', 'jsx', 21],
      ['public/notes/guide/flow.html', 'directive', 23],
      ['public/notes/guide/b.svg', 'directive', 25],
    ]);
  });

  it('points at the path only, without the query or hash', () => {
    const refs = findAssetRefs(NOTE, 'guide/intro.mdx') ?? [];
    expect(refs.map((ref) => NOTE.slice(ref.start, ref.end))).toEqual([
      '/notes/guide/a.png',
      '/notes/guide/spec.pdf',
      '/notes/guide/spec.pdf',
      '/notes/guide/flow.html',
      'notes/guide/b.svg',
      '/notes/guide/a.png',
      '/notes/guide/flow.html',
      '/notes/guide/b.svg',
    ]);
    for (const ref of refs) expect(at(NOTE, ref.line).slice(ref.column - 1)).toMatch(/^\/?notes\//);
  });

  it('resolves relative links against the page URL, as the site does', () => {
    const source = '[a](./a.png) [b](../b.png) [c](c/d.pdf)\n';
    expect(findAssetRefs(source, 'guide/intro.mdx')?.map((ref) => ref.asset)).toEqual([
      'public/notes/guide/a.png',
      'public/notes/b.png',
      'public/notes/guide/c/d.pdf',
    ]);
    // A folder page's URL is the folder: ./ is its parent.
    expect(findAssetRefs('[a](./a.png)\n', 'guide/index.mdx')?.map((ref) => ref.asset)).toEqual(['public/notes/a.png']);
  });

  it('returns null for a note that does not parse', () => {
    expect(findAssetRefs('<HtmlEmbed src="/notes/a.html"\n', 'a.mdx')).toBeNull();
  });

  it('matches the real notes: every reference reaches a file in public/notes', async () => {
    const refs = (await realNotes()).flatMap(({ path, source }) => findAssetRefs(source, path.slice('content/notes/'.length)) ?? []);
    expect(refs.length).toBeGreaterThanOrEqual(15);
    for (const ref of refs) expect(existsSync(join(repoRoot, ref.asset)), ref.asset).toBe(true);
    expect(new Set(refs.map((ref) => ref.kind))).toEqual(new Set(['image', 'jsx']));
  });
});

describe('rewriteAssetRefs', () => {
  const rename = (from: string, to: string) => (asset: string) => (asset === from ? to : null);

  it('renames the file in every reference, keeping query, hash and how each was written', () => {
    const result = rewriteAssetRefs(NOTE, 'guide/intro.mdx', rename('public/notes/guide/flow.html', 'public/notes/guide/data-flow.html'));
    expect(result?.count).toBe(2);
    expect(result?.next).toBe(NOTE.replaceAll('/notes/guide/flow.html?embed=1', '/notes/guide/data-flow.html?embed=1'));
  });

  it('keeps relative paths relative when only the name changes', () => {
    const source = '[a](../b.png) [b](./b.png#x)\n';
    const result = rewriteAssetRefs(source, 'guide/intro.mdx', rename('public/notes/b.png', 'public/notes/c.png'));
    expect(result).toEqual({ next: '[a](../c.png) [b](./b.png#x)\n', count: 1 });
  });

  it('writes the site path when the folder changes', () => {
    const source = '[a](../b.png)\n\n<SvgDiagram src="notes/b.svg" />\n\n![x](/notes/b.png)\n';
    const moved = (asset: string) => asset.replace('public/notes/', 'public/notes/moved/');
    expect(rewriteAssetRefs(source, 'guide/intro.mdx', moved)?.next).toBe(
      '[a](/notes/moved/b.png)\n\n<SvgDiagram src="notes/moved/b.svg" />\n\n![x](/notes/moved/b.png)\n',
    );
  });

  it('leaves the frontmatter, other files and unparsable notes alone', () => {
    const result = rewriteAssetRefs(NOTE, 'guide/intro.mdx', rename('public/notes/guide/a.png', 'public/notes/guide/hero.png'));
    expect(result?.count).toBe(2);
    expect(result?.next).toContain('cover: /notes/guide/a.png');
    expect(result?.next).toContain('[Elsewhere](https://example.com/notes/guide/a.png)');
    expect(rewriteAssetRefs('<a\n', 'a.mdx', () => 'public/notes/x.png')).toBeNull();
  });
});
