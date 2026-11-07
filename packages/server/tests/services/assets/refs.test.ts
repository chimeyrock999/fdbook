import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findAssetRefs, rewriteAssetRefs } from '#services/assets/refs.ts';
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

<img
  alt="Flow"
  src="/docs/guide/flow.svg?v=1"
/>

<img src="/docs/guide/a.png" alt="" />

[A page](/docs/guide) · [Elsewhere](https://example.com/docs/guide/a.png) · <img src={dynamic} />
`;

const at = (source: string, line: number) => source.split('\n')[line - 1];

describe('findAssetRefs', () => {
  it('finds every kind of reference to a file under public/docs, by line', () => {
    const refs = findAssetRefs(NOTE, 'guide/intro.mdx');
    expect(refs?.map(({ asset, kind, line }) => [asset, kind, line])).toEqual([
      ['public/docs/guide/a.png', 'image', 6],
      ['public/docs/guide/spec.pdf', 'link', 10],
      ['public/docs/guide/spec.pdf', 'link', 12],
      ['public/docs/guide/flow.svg', 'jsx', 16],
      ['public/docs/guide/a.png', 'jsx', 19],
    ]);
  });

  it('points at the path only, without the query or hash', () => {
    const refs = findAssetRefs(NOTE, 'guide/intro.mdx') ?? [];
    expect(refs.map((ref) => NOTE.slice(ref.start, ref.end))).toEqual([
      '/docs/guide/a.png',
      '/docs/guide/spec.pdf',
      '/docs/guide/spec.pdf',
      '/docs/guide/flow.svg',
      '/docs/guide/a.png',
    ]);
    for (const ref of refs) expect(at(NOTE, ref.line).slice(ref.column - 1)).toMatch(/^\/docs\//);
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

  it('reads every way the site accepts a src: string expressions, encoded images', () => {
    const source = [
      '<img src={"/docs/guide/flow.svg?v=1"} />',
      '',
      "<img src={ '/docs/guide/b.svg' } />",
      '',
      '<img src={`/docs/guide/${name}.svg`} />',
      '',
      '![a](/docs/guide/my%20pic.png)',
      '',
    ].join('\n');
    const refs = findAssetRefs(source, 'guide/intro.mdx') ?? [];
    expect(refs.map(({ asset, kind, line }) => [asset, kind, line])).toEqual([
      ['public/docs/guide/flow.svg', 'jsx', 1],
      ['public/docs/guide/b.svg', 'jsx', 3],
      ['public/docs/guide/my pic.png', 'image', 7],
    ]);
    expect(refs.map((ref) => source.slice(ref.start, ref.end))).toEqual([
      '/docs/guide/flow.svg',
      '/docs/guide/b.svg',
      '/docs/guide/my%20pic.png',
    ]);
    const moved = (asset: string) => asset.replace(/\/(flow|b|my pic)\./, '/renamed.');
    expect(rewriteAssetRefs(source, 'guide/intro.mdx', moved)?.next).toBe(
      source
        .replace('src={"/docs/guide/flow.svg?v=1"}', 'src={"/docs/guide/renamed.svg?v=1"}')
        .replace("src={ '/docs/guide/b.svg' }", "src={ '/docs/guide/renamed.svg' }")
        .replace('(/docs/guide/my%20pic.png)', '(/docs/guide/renamed.png)'),
    );
  });

  it('leaves components the site does not define alone', () => {
    const source = '<HtmlEmbed src="/docs/guide/flow.html" />\n\n<SvgDiagram src="/docs/guide/b.svg" />\n\n::svg{src="/docs/guide/b.svg"}\n';
    expect(findAssetRefs(source, 'guide/intro.mdx')).toEqual([]);
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
    const source = '![a](/docs/x/a&#46;png)\n\n<img src="/docs/x/a&#x2E;png" />\n';
    const refs = findAssetRefs(source, 'a.mdx') ?? [];
    expect(refs.map((ref) => [ref.asset, ref.exact])).toEqual([
      ['public/docs/x/a.png', true],
      ['public/docs/x/a.png', true],
    ]);
    expect(rewriteAssetRefs(source, 'a.mdx', () => 'public/docs/x/b.png')?.next).toBe('![a](/docs/x/b.png)\n\n<img src="/docs/x/b.png" />\n');
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
    expect(findAssetRefs('<img src="/docs/a.png"\n', 'a.mdx')).toBeNull();
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

    it('finds images and diagrams among them', () => {
      // The docs' files: the <Diagram>s of the home page (one) and of
      // diagrams/examples (five), and the image in guide/using; the inline
      // cases above cover the other kinds.
      expect(found.length).toBeGreaterThanOrEqual(7);
      expect(new Set(found.map((ref) => ref.kind))).toEqual(new Set(['image', 'diagram']));
      expect(found.map((ref) => ref.asset)).toEqual(expect.arrayContaining(['public/docs/guide/using/studio-panes.svg', 'diagrams/reference/studio-layout.diagram.json', 'diagrams/examples/deployment-release.diagram.json']));
    });
  });
});

describe('rewriteAssetRefs', () => {
  const rename = (from: string, to: string) => (asset: string) => (asset === from ? to : null);

  it('renames the file in every reference, keeping query, hash and how each was written', () => {
    const result = rewriteAssetRefs(NOTE, 'guide/intro.mdx', rename('public/docs/guide/spec.pdf', 'public/docs/guide/data-spec.pdf'));
    expect(result?.count).toBe(2);
    expect(result?.next).toBe(NOTE.replace('/docs/guide/spec.pdf#page=2', '/docs/guide/data-spec.pdf#page=2').replace('</docs/guide/spec.pdf>', '</docs/guide/data-spec.pdf>'));
  });

  it('keeps relative paths relative when only the name changes', () => {
    const source = '[a](../b.png) [b](./b.png#x)\n';
    const result = rewriteAssetRefs(source, 'guide/intro.mdx', rename('public/docs/b.png', 'public/docs/c.png'));
    expect(result).toEqual({ next: '[a](../c.png) [b](./b.png#x)\n', count: 1 });
  });

  it('writes the site path when the folder changes', () => {
    const source = '[a](../b.png)\n\n<img src="/docs/b.svg" />\n\n![x](/docs/b.png)\n';
    const moved = (asset: string) => asset.replace('public/docs/', 'public/docs/moved/');
    expect(rewriteAssetRefs(source, 'guide/intro.mdx', moved)?.next).toBe(
      '[a](/docs/moved/b.png)\n\n<img src="/docs/moved/b.svg" />\n\n![x](/docs/moved/b.png)\n',
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
