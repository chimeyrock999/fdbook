import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findAssetRefs, rewriteAssetRefs } from '../../../server/assets/refs';
import { repoRoot } from '../../../server/config';
import { realNotes } from '../../support/notes';

const notes = await realNotes();

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

  it('reads every way the site accepts a src: spaced directive attributes, string expressions, encoded images', () => {
    const source = [
      '::html{src = "/notes/guide/flow.html"}',
      '',
      '<HtmlEmbed src={"/notes/guide/flow.html?embed=1"} />',
      '',
      "<SvgDiagram src={ '/notes/guide/b.svg' } />",
      '',
      '<HtmlEmbed src={`/notes/guide/${name}.html`} />',
      '',
      '![a](/notes/guide/my%20pic.png)',
      '',
    ].join('\n');
    const refs = findAssetRefs(source, 'guide/intro.mdx') ?? [];
    expect(refs.map(({ asset, kind, line }) => [asset, kind, line])).toEqual([
      ['public/notes/guide/flow.html', 'directive', 1],
      ['public/notes/guide/flow.html', 'jsx', 3],
      ['public/notes/guide/b.svg', 'jsx', 5],
      ['public/notes/guide/my pic.png', 'image', 9],
    ]);
    expect(refs.map((ref) => source.slice(ref.start, ref.end))).toEqual([
      '/notes/guide/flow.html',
      '/notes/guide/flow.html',
      '/notes/guide/b.svg',
      '/notes/guide/my%20pic.png',
    ]);
    const moved = (asset: string) => asset.replace(/\/(flow|b|my pic)\./, '/renamed.');
    expect(rewriteAssetRefs(source, 'guide/intro.mdx', moved)?.next).toBe(
      source
        .replace('src = "/notes/guide/flow.html"', 'src = "/notes/guide/renamed.html"')
        .replace('src={"/notes/guide/flow.html?embed=1"}', 'src={"/notes/guide/renamed.html?embed=1"}')
        .replace("src={ '/notes/guide/b.svg' }", "src={ '/notes/guide/renamed.svg' }")
        .replace('(/notes/guide/my%20pic.png)', '(/notes/guide/renamed.png)'),
    );
  });

  it('gives a linked image and its link their own ranges', () => {
    const source = '[![a](/notes/x/a.png)](/notes/x/a.png)\n';
    const refs = findAssetRefs(source, 'guide/intro.mdx') ?? [];
    expect(refs.map((ref) => [ref.kind, ref.start, ref.end])).toEqual([
      ['image', 6, 20],
      ['link', 23, 37],
    ]);
    expect(rewriteAssetRefs(source, 'guide/intro.mdx', () => 'public/notes/x/renamed-asset.png')?.next).toBe(
      '[![a](/notes/x/renamed-asset.png)](/notes/x/renamed-asset.png)\n',
    );
  });

  it('never splices two overlapping ranges', () => {
    const source = '![a](/notes/x/a.png)\n';
    const [ref] = findAssetRefs(source, 'a.mdx') ?? [];
    const result = rewriteAssetRefs(source, 'a.mdx', () => 'public/notes/x/b.png', [ref, { ...ref }]);
    expect(result).toEqual({ next: '![a](/notes/x/b.png)\n', count: 1 });
  });

  it('reads character references in a path', () => {
    const source = '![a](/notes/x/a&#46;png)\n\n::svg{src="/notes/x/a&#x2E;png"}\n';
    const refs = findAssetRefs(source, 'a.mdx') ?? [];
    expect(refs.map((ref) => [ref.asset, ref.exact])).toEqual([
      ['public/notes/x/a.png', true],
      ['public/notes/x/a.png', true],
    ]);
    expect(rewriteAssetRefs(source, 'a.mdx', () => 'public/notes/x/b.png')?.next).toBe('![a](/notes/x/b.png)\n\n::svg{src="/notes/x/b.png"}\n');
  });

  it('finds a directive src only where an attribute starts, after the label', () => {
    const source = '::svg[a src=x]{src="/notes/x/a.png"}\n\n::svg{label="a src=/notes/x/b.png" src="/notes/x/a.png"}\n';
    const refs = findAssetRefs(source, 'a.mdx') ?? [];
    expect(refs.map((ref) => [ref.asset, source.slice(ref.start, ref.end), ref.exact])).toEqual([
      ['public/notes/x/a.png', '/notes/x/a.png', true],
      ['public/notes/x/a.png', '/notes/x/a.png', true],
    ]);
    expect(refs[1].start).toBe(source.lastIndexOf('/notes/x/a.png'));
  });

  it('keeps a reference it cannot place as not exact, and never rewrites it', () => {
    const source = '![a](/notes/x/a&period;png)\n';
    const refs = findAssetRefs(source, 'a.mdx') ?? [];
    expect(refs.map((ref) => [ref.asset, ref.exact, ref.line])).toEqual([['public/notes/x/a.png', false, 1]]);
    expect(rewriteAssetRefs(source, 'a.mdx', () => 'public/notes/x/b.png')).toEqual({ next: source, count: 0 });
  });

  it('rewrites from references found earlier, without parsing again', () => {
    const source = '![a](/notes/guide/a.png)\n';
    const refs = findAssetRefs(source, 'guide/intro.mdx');
    const result = rewriteAssetRefs('this text is not parsed', 'guide/intro.mdx', () => null, refs);
    expect(result).toEqual({ next: 'this text is not parsed', count: 0 });
    expect(rewriteAssetRefs(source, 'guide/intro.mdx', () => 'public/notes/guide/b.png', refs)?.next).toBe('![a](/notes/guide/b.png)\n');
  });

  it('returns null for a note that does not parse', () => {
    expect(findAssetRefs('<HtmlEmbed src="/notes/a.html"\n', 'a.mdx')).toBeNull();
  });

  // One test per note, each well inside the default timeout; the last one
  // checks what they found together (tests in a file run in order).
  describe('on the real notes', () => {
    const found: { asset: string; kind: string }[] = [];

    it.each(notes)('every reference in $path reaches a file in public/notes', ({ path, source }) => {
      const refs = findAssetRefs(source, path.slice('content/notes/'.length)) ?? [];
      for (const ref of refs) expect(existsSync(join(repoRoot, ref.asset)), ref.asset).toBe(true);
      found.push(...refs);
    });

    it('finds images and components among them', () => {
      expect(found.length).toBeGreaterThanOrEqual(15);
      expect(new Set(found.map((ref) => ref.kind))).toEqual(new Set(['image', 'jsx']));
    });
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
