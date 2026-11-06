import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findAssetRefs, rewriteAssetRefs } from '#assets/refs.ts';
import { docsRoot, realNotes } from '@fdbook/testing/notes.ts';

const notes = await realNotes();

const NOTE = `---
title: Demo
cover: /docs/guide/a.png
---

![A diagram](/docs/guide/a.png)

![Relative, imported by MDX](./a.png)

See [the PDF](/docs/guide/spec.pdf#page=2) and [ref][spec].

[spec]: </docs/guide/spec.pdf>

<HtmlEmbed
  title="Flow"
  src="/docs/guide/flow.html?embed=1"
/>

<SvgDiagram src="docs/guide/b.svg" />

<img src="/docs/guide/a.png" alt="" />

::html{src="/docs/guide/flow.html?embed=1" title="Flow"}

::diagram{#d src=/docs/guide/b.svg}

[A page](/docs/guide) · [Elsewhere](https://example.com/docs/guide/a.png) · <HtmlEmbed src={dynamic} />
`;

const at = (source: string, line: number) => source.split('\n')[line - 1];

describe('findAssetRefs', () => {
  it('finds every kind of reference to a file under public/docs, by line', () => {
    const refs = findAssetRefs(NOTE, 'guide/intro.mdx');
    expect(refs?.map(({ asset, kind, line }) => [asset, kind, line])).toEqual([
      ['public/docs/guide/a.png', 'image', 6],
      ['public/docs/guide/spec.pdf', 'link', 10],
      ['public/docs/guide/spec.pdf', 'link', 12],
      ['public/docs/guide/flow.html', 'jsx', 16],
      ['public/docs/guide/b.svg', 'jsx', 19],
      ['public/docs/guide/a.png', 'jsx', 21],
      ['public/docs/guide/flow.html', 'directive', 23],
      ['public/docs/guide/b.svg', 'directive', 25],
    ]);
  });

  it('points at the path only, without the query or hash', () => {
    const refs = findAssetRefs(NOTE, 'guide/intro.mdx') ?? [];
    expect(refs.map((ref) => NOTE.slice(ref.start, ref.end))).toEqual([
      '/docs/guide/a.png',
      '/docs/guide/spec.pdf',
      '/docs/guide/spec.pdf',
      '/docs/guide/flow.html',
      'docs/guide/b.svg',
      '/docs/guide/a.png',
      '/docs/guide/flow.html',
      '/docs/guide/b.svg',
    ]);
    for (const ref of refs) expect(at(NOTE, ref.line).slice(ref.column - 1)).toMatch(/^\/?docs\//);
  });

  it('resolves relative links against the page URL, as the site does', () => {
    const source = '[a](./a.png) [b](../b.png) [c](c/d.pdf)\n';
    expect(findAssetRefs(source, 'guide/intro.mdx')?.map((ref) => ref.asset)).toEqual([
      'public/docs/guide/a.png',
      'public/docs/b.png',
      'public/docs/guide/c/d.pdf',
    ]);
    // A folder page's URL is the folder: ./ is its parent.
    expect(findAssetRefs('[a](./a.png)\n', 'guide/index.mdx')?.map((ref) => ref.asset)).toEqual(['public/docs/a.png']);
  });

  it('reads every way the site accepts a src: spaced directive attributes, string expressions, encoded images', () => {
    const source = [
      '::html{src = "/docs/guide/flow.html"}',
      '',
      '<HtmlEmbed src={"/docs/guide/flow.html?embed=1"} />',
      '',
      "<SvgDiagram src={ '/docs/guide/b.svg' } />",
      '',
      '<HtmlEmbed src={`/docs/guide/${name}.html`} />',
      '',
      '![a](/docs/guide/my%20pic.png)',
      '',
    ].join('\n');
    const refs = findAssetRefs(source, 'guide/intro.mdx') ?? [];
    expect(refs.map(({ asset, kind, line }) => [asset, kind, line])).toEqual([
      ['public/docs/guide/flow.html', 'directive', 1],
      ['public/docs/guide/flow.html', 'jsx', 3],
      ['public/docs/guide/b.svg', 'jsx', 5],
      ['public/docs/guide/my pic.png', 'image', 9],
    ]);
    expect(refs.map((ref) => source.slice(ref.start, ref.end))).toEqual([
      '/docs/guide/flow.html',
      '/docs/guide/flow.html',
      '/docs/guide/b.svg',
      '/docs/guide/my%20pic.png',
    ]);
    const moved = (asset: string) => asset.replace(/\/(flow|b|my pic)\./, '/renamed.');
    expect(rewriteAssetRefs(source, 'guide/intro.mdx', moved)?.next).toBe(
      source
        .replace('src = "/docs/guide/flow.html"', 'src = "/docs/guide/renamed.html"')
        .replace('src={"/docs/guide/flow.html?embed=1"}', 'src={"/docs/guide/renamed.html?embed=1"}')
        .replace("src={ '/docs/guide/b.svg' }", "src={ '/docs/guide/renamed.svg' }")
        .replace('(/docs/guide/my%20pic.png)', '(/docs/guide/renamed.png)'),
    );
  });

  it('gives a linked image and its link their own ranges', () => {
    const source = '[![a](/docs/x/a.png)](/docs/x/a.png)\n';
    const refs = findAssetRefs(source, 'guide/intro.mdx') ?? [];
    expect(refs.map((ref) => [ref.kind, ref.start, ref.end])).toEqual([
      ['image', 6, 19],
      ['link', 22, 35],
    ]);
    expect(rewriteAssetRefs(source, 'guide/intro.mdx', () => 'public/docs/x/renamed-asset.png')?.next).toBe(
      '[![a](/docs/x/renamed-asset.png)](/docs/x/renamed-asset.png)\n',
    );
  });

  it('never splices two overlapping ranges', () => {
    const source = '![a](/docs/x/a.png)\n';
    const [ref] = findAssetRefs(source, 'a.mdx') ?? [];
    const result = rewriteAssetRefs(source, 'a.mdx', () => 'public/docs/x/b.png', [ref, { ...ref }]);
    expect(result).toEqual({ next: '![a](/docs/x/b.png)\n', count: 1 });
  });

  it('reads character references in a path', () => {
    const source = '![a](/docs/x/a&#46;png)\n\n::svg{src="/docs/x/a&#x2E;png"}\n';
    const refs = findAssetRefs(source, 'a.mdx') ?? [];
    expect(refs.map((ref) => [ref.asset, ref.exact])).toEqual([
      ['public/docs/x/a.png', true],
      ['public/docs/x/a.png', true],
    ]);
    expect(rewriteAssetRefs(source, 'a.mdx', () => 'public/docs/x/b.png')?.next).toBe('![a](/docs/x/b.png)\n\n::svg{src="/docs/x/b.png"}\n');
  });

  it('finds a directive src only where an attribute starts, after the label', () => {
    const source = '::svg[a src=x]{src="/docs/x/a.png"}\n\n::svg{label="a src=/docs/x/b.png" src="/docs/x/a.png"}\n';
    const refs = findAssetRefs(source, 'a.mdx') ?? [];
    expect(refs.map((ref) => [ref.asset, source.slice(ref.start, ref.end), ref.exact])).toEqual([
      ['public/docs/x/a.png', '/docs/x/a.png', true],
      ['public/docs/x/a.png', '/docs/x/a.png', true],
    ]);
    expect(refs[1].start).toBe(source.lastIndexOf('/docs/x/a.png'));
  });

  it('keeps a reference it cannot place as not exact, and never rewrites it', () => {
    const source = '![a](/docs/x/a&period;png)\n';
    const refs = findAssetRefs(source, 'a.mdx') ?? [];
    expect(refs.map((ref) => [ref.asset, ref.exact, ref.line])).toEqual([['public/docs/x/a.png', false, 1]]);
    expect(rewriteAssetRefs(source, 'a.mdx', () => 'public/docs/x/b.png')).toEqual({ next: source, count: 0 });
  });

  it('rewrites from references found earlier, without parsing again', () => {
    const source = '![a](/docs/guide/a.png)\n';
    const refs = findAssetRefs(source, 'guide/intro.mdx');
    const result = rewriteAssetRefs('this text is not parsed', 'guide/intro.mdx', () => null, refs);
    expect(result).toEqual({ next: 'this text is not parsed', count: 0 });
    expect(rewriteAssetRefs(source, 'guide/intro.mdx', () => 'public/docs/guide/b.png', refs)?.next).toBe('![a](/docs/guide/b.png)\n');
  });

  it('returns null for a note that does not parse', () => {
    expect(findAssetRefs('<HtmlEmbed src="/docs/a.html"\n', 'a.mdx')).toBeNull();
  });

  it('finds a <Diagram src> as its file under diagrams/, never to rewrite', () => {
    const source = '<Diagram src="guide/flow" caption="x" />\n\n<Diagram src={"/guide/flow.diagram.json"} />\n\n<Diagram src="../outside" />\n';
    const refs = findAssetRefs(source, 'guide/intro.mdx') ?? [];
    expect(refs.map(({ asset, kind, line, exact }) => ({ asset, kind, line, exact }))).toEqual([
      { asset: 'diagrams/guide/flow.diagram.json', kind: 'diagram', line: 1, exact: true },
      { asset: 'diagrams/guide/flow.diagram.json', kind: 'diagram', line: 3, exact: true },
    ]);
    expect(source.slice(refs[0].start, refs[0].end)).toBe('guide/flow');
    expect(rewriteAssetRefs(source, 'guide/intro.mdx', () => 'diagrams/other.diagram.json')).toEqual({ next: source, count: 0 });
  });

  // One test per note, each well inside the default timeout; the last one
  // checks what they found together (tests in a file run in order).
  describe('on the real notes', () => {
    const found: { asset: string; kind: string }[] = [];

    it.each(notes)('every reference in $path reaches a file in public/docs', ({ path, source }) => {
      const refs = findAssetRefs(source, path.slice('content/docs/'.length)) ?? [];
      for (const ref of refs) expect(existsSync(join(docsRoot, ref.asset)), ref.asset).toBe(true);
      found.push(...refs);
    });

    it('finds the diagrams among them', () => {
      // The docs show no image: their files are the <Diagram>s of the home
      // page (one) and of diagrams/examples (five); the kinds above cover the rest.
      expect(found.length).toBeGreaterThanOrEqual(6);
      expect(new Set(found.map((ref) => ref.kind))).toEqual(new Set(['diagram']));
      expect(found.map((ref) => ref.asset)).toEqual(expect.arrayContaining(['diagrams/reference/studio-layout.diagram.json', 'diagrams/examples/deployment-release.diagram.json']));
    });
  });
});

describe('rewriteAssetRefs', () => {
  const rename = (from: string, to: string) => (asset: string) => (asset === from ? to : null);

  it('renames the file in every reference, keeping query, hash and how each was written', () => {
    const result = rewriteAssetRefs(NOTE, 'guide/intro.mdx', rename('public/docs/guide/flow.html', 'public/docs/guide/data-flow.html'));
    expect(result?.count).toBe(2);
    expect(result?.next).toBe(NOTE.replaceAll('/docs/guide/flow.html?embed=1', '/docs/guide/data-flow.html?embed=1'));
  });

  it('keeps relative paths relative when only the name changes', () => {
    const source = '[a](../b.png) [b](./b.png#x)\n';
    const result = rewriteAssetRefs(source, 'guide/intro.mdx', rename('public/docs/b.png', 'public/docs/c.png'));
    expect(result).toEqual({ next: '[a](../c.png) [b](./b.png#x)\n', count: 1 });
  });

  it('writes the site path when the folder changes', () => {
    const source = '[a](../b.png)\n\n<SvgDiagram src="docs/b.svg" />\n\n![x](/docs/b.png)\n';
    const moved = (asset: string) => asset.replace('public/docs/', 'public/docs/moved/');
    expect(rewriteAssetRefs(source, 'guide/intro.mdx', moved)?.next).toBe(
      '[a](/docs/moved/b.png)\n\n<SvgDiagram src="docs/moved/b.svg" />\n\n![x](/docs/moved/b.png)\n',
    );
  });

  it('leaves the frontmatter, other files and unparsable notes alone', () => {
    const result = rewriteAssetRefs(NOTE, 'guide/intro.mdx', rename('public/docs/guide/a.png', 'public/docs/guide/hero.png'));
    expect(result?.count).toBe(2);
    expect(result?.next).toContain('cover: /docs/guide/a.png');
    expect(result?.next).toContain('[Elsewhere](https://example.com/docs/guide/a.png)');
    expect(rewriteAssetRefs('<a\n', 'a.mdx', () => 'public/docs/x.png')).toBeNull();
  });
});
