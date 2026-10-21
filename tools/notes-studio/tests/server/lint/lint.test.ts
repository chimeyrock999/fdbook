import { describe, expect, it } from 'vitest';
import { lintNote } from '../../../server/lint/lint';
import type { LintIssue } from '../../../server/lint/types';

const PAGES = ['index.mdx', 'guide/index.mdx', 'guide/intro.mdx', 'guide/setup.mdx', 'other/page.mdx'];
const ASSETS = ['notes/guide/demo.html', 'notes/guide/arch.svg', 'images/logo.png'];

function lint(source: string, { path = 'guide/intro.mdx', pages = PAGES, assets = ASSETS } = {}) {
  return lintNote(source, { path, pages: new Set(pages), assetExists: (asset) => assets.includes(asset) });
}

// rule@line, for compact assertions.
const summary = (issues: LintIssue[]) => issues.map((issue) => `${issue.rule}@${String(issue.start.line)}`);

describe('directives', () => {
  it('accepts every directive the site renders', () => {
    const source = [
      ':::note[Title]', 'body', ':::',
      '', ':::example', 'x', ':::',
      '', '::::accordions', ':::accordion{title="Q" kind="question"}', 'a', ':::', '::::',
      '', '::::tabs', ':::tab{value="A"}', 'a', ':::', ':::tab[B]', 'b', ':::', '::::',
      '', '::youtube{url="https://youtu.be/x"}',
      '', 'A :keyword[Map]{id="map"} and :tag[t]{id="t"}.',
    ].join('\n');
    expect(lint(source)).toEqual([]);
  });

  it('flags unknown container and leaf directives', () => {
    const issues = lint(':::exmaple[Ví dụ]\nbody\n:::\n\n::vimeo{id="1"}\n');
    expect(summary(issues)).toEqual(['directive-unknown@1', 'directive-unknown@5']);
    expect(issues[0]).toMatchObject({ severity: 'error', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 18 } });
    expect(issues[0]?.message).toContain(':::exmaple');
  });

  it('flags a text directive with a label or attributes, not bare `word:word` text', () => {
    expect(summary(lint('See :keywrod[Map]{id="map"} and :abc{x="1"}.\n'))).toEqual(['directive-unknown@1', 'directive-unknown@1']);
    expect(lint('At 10:01 open localhost:3000, ratio a:b and note:this.\n')).toEqual([]);
  });

  it('flags a tab with neither a value nor a label', () => {
    expect(summary(lint('::::tabs\n:::tab\nx\n:::\n::::\n'))).toEqual(['directive-unknown@2']);
  });

  it('flags an unclosed container', () => {
    expect(summary(lint('Intro\n\n:::note\nno close\n\nmore\n'))).toEqual(['directive-unclosed@3']);
  });

  it('flags a nested container with as many colons as its parent, and the fence left over', () => {
    const issues = lint(':::note\nouter\n:::tip\ninner\n:::\nafter\n:::\n');
    expect(summary(issues)).toEqual(['directive-nesting@3', 'directive-nesting@7']);
    expect(issues[1]?.start).toEqual({ line: 7, column: 1, offset: 37 });
  });

  it('accepts nesting with more colons on the outside', () => {
    expect(lint('::::note\nouter\n:::tip\ninner\n:::\nafter\n::::\n')).toEqual([]);
  });

  it('flags a stray closing fence', () => {
    expect(summary(lint('text\n\n:::\n\nmore\n'))).toEqual(['directive-nesting@3']);
  });

  it('ignores code blocks and inline code', () => {
    const source = ['```md', ':::exmaple', '::vimeo', '[x](./missing.mdx)', '```', '', 'Inline `:::nope` and `:bad[x]{y}`.'].join('\n');
    expect(lint(source)).toEqual([]);
  });
});

describe('callouts and accordions', () => {
  it('accepts every callout type, idea included', () => {
    expect(lint('<Callout type="idea">x</Callout>\n\n<Callout type="example">x</Callout>\n\n<Callout>x</Callout>\n')).toEqual([]);
  });

  it('flags an unknown callout type', () => {
    const issues = lint('<Callout type="hint">x</Callout>\n');
    expect(summary(issues)).toEqual(['callout-type@1']);
    expect(issues[0]?.message).toContain('hint');
  });

  it('flags an unknown accordion kind, in a directive or JSX', () => {
    const source = '::::accordions\n:::accordion{title="Q" kind="faq"}\na\n:::\n::::\n\n<Accordions><Accordion title="A" kind="tips">x</Accordion></Accordions>\n';
    expect(summary(lint(source))).toEqual(['accordion-kind@2', 'accordion-kind@7']);
  });
});

describe('links', () => {
  it('accepts links that reach a page', () => {
    const source = [
      '[a](./setup.mdx) [b](./setup.mdx#step-2) [c](../other/page.mdx) [d](./index.mdx)',
      '[e](/notes/guide/setup) [f](/notes/guide/) [g](/notes) [h](#local) [i](https://example.com)',
      '[j](./setup) [k](mailto:a@b.c) [l](/resume)',
    ].join('\n');
    expect(lint(source)).toEqual([]);
  });

  it('resolves an extensionless relative link against the page URL, as the browser does', () => {
    // guide/intro.mdx is served at /notes/guide/intro, so ./x is /notes/guide/x.
    expect(lint('[x](./setup)\n')).toEqual([]);
    expect(summary(lint('[x](./setup)\n', { path: 'guide/index.mdx' }))).toEqual(['link-broken@1']);
  });

  it('flags relative and /notes links that reach no page', () => {
    const issues = lint('[a](./missing.mdx) [b](../nope/page.mdx)\n\n[c](/notes/guide/missing#x) [d](./missing)\n');
    expect(summary(issues)).toEqual(['link-broken@1', 'link-broken@1', 'link-broken@3', 'link-broken@3']);
    expect(issues[0]?.message).toContain('./missing.mdx');
  });

  it('flags a query on a relative .mdx link, which the site does not strip', () => {
    // source.resolveHref looks up `setup.mdx?tab=a` as a file name; the browser then gets /notes/guide/setup.mdx.
    expect(summary(lint('[x](./setup.mdx?tab=a) [y](./setup.mdx#a)\n'))).toEqual(['link-broken@1']);
  });

  it('checks link definitions too', () => {
    expect(summary(lint('[x][ref]\n\n[ref]: ./missing.mdx\n'))).toEqual(['link-broken@3']);
  });
});

describe('assets', () => {
  it('accepts assets that exist in public/, ignoring query and hash', () => {
    const source = [
      '<HtmlEmbed src="/notes/guide/demo.html?embed=1" />',
      '',
      '<SvgDiagram src="/notes/guide/arch.svg" />',
      '',
      '::html{src="/notes/guide/demo.html"}',
      '',
      '::svg{src="/notes/guide/arch.svg#x"}',
      '',
      '![logo](/images/logo.png)',
      '',
      '<SvgDiagram svg="<svg/>" />',
    ].join('\n');
    expect(lint(source)).toEqual([]);
  });

  it('flags an embed from a URL, since the site only reads public/', () => {
    const source = '<SvgDiagram src="https://cdn.example.com/a.svg" />\n\n::html{src="data:text/html,x"}\n';
    expect(summary(lint(source))).toEqual(['asset-missing@1', 'asset-missing@3']);
  });

  it('flags missing assets and embeds with no source', () => {
    const source = '<HtmlEmbed src="/notes/guide/gone.html" />\n\n::diagram{src="/notes/x.svg"}\n\n![a](/images/none.png)\n\n<HtmlEmbed title="t" />\n';
    expect(summary(lint(source))).toEqual(['asset-missing@1', 'asset-missing@3', 'asset-missing@5', 'asset-missing@7']);
  });
});

describe('graph markers', () => {
  it('accepts complete markers, and the same id on two pages', () => {
    const source = '## Setup <GraphMeta id="setup" displayName="Setup" />\n\nA :keyword[Map]{id="map"} and <Keyword id="k" displayName="K">k</Keyword>.\n';
    expect(lint(source)).toEqual([]);
  });

  it('flags two sections with one id in a page', () => {
    const source = '## A <GraphMeta id="dup" displayName="A" />\n\n## B :graph-meta{id="dup" displayName="B"}\n\n<SectionTitle id="dup" displayName="C" />\n';
    expect(summary(lint(source))).toEqual(['graph-id-duplicate@3', 'graph-id-duplicate@5']);
  });

  it('counts every marker the graph reads as a section', () => {
    const source = [
      '<GraphSection id="a" displayName="A" />',
      '',
      '<GraphSection id="a" displayName="A2" />',
      '',
      '<Keyword id="b" displayName="B" graphType="section">b</Keyword>',
      '',
      '<Keyword id="b" displayName="B2" graphKind="section">b</Keyword>',
      '',
      '<GraphSection displayName="no id" />',
    ].join('\n');
    expect(summary(lint(source))).toEqual(['graph-id-duplicate@3', 'graph-id-duplicate@7', 'graph-meta-incomplete@9']);
  });

  it('lets keywords repeat an id, or point at a section by its id', () => {
    // As in distributed-systems/rpc-and-threads.mdx: the keyword links to its section.
    const source = '## Process :graph-meta{id="process" displayName="Process"}\n\nA <Keyword id="process" displayName="process">[process](#process)</Keyword> and :keyword[p]{id="process"}.\n';
    expect(lint(source)).toEqual([]);
  });

  it('flags a marker without an id, or a keyword the graph drops', () => {
    const source = '## A <GraphMeta displayName="A" />\n\n<Keyword id="k">k</Keyword>\n\n<Tag displayName="T">t</Tag>\n';
    const issues = lint(source);
    expect(summary(issues)).toEqual(['graph-meta-incomplete@1', 'graph-meta-incomplete@3', 'graph-meta-incomplete@5']);
    expect(issues.every((issue) => issue.severity === 'error')).toBe(true);
  });

  it('warns when GraphMeta has no displayName, since the heading text stands in', () => {
    const issues = lint('## Setup <GraphMeta id="setup" />\n');
    expect(issues).toMatchObject([{ rule: 'graph-meta-incomplete', severity: 'warning' }]);
  });
});

describe('the file as a whole', () => {
  it('keeps line numbers of the file when there is frontmatter', () => {
    const issues = lint('---\ntitle: T\ngraph:\n  id: x\n---\n\n:::nope\nx\n:::\n');
    expect(summary(issues)).toEqual(['directive-unknown@7']);
  });

  it('reports a parse error with its position instead of throwing', () => {
    const issues = lint('# T\n\n<Callout type="note">\nunclosed\n');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: 'mdx-parse', severity: 'error' });
    expect(issues[0]?.start.line).toBeGreaterThan(0);
  });

  it('sorts issues by position', () => {
    const issues = lint('[a](./gone.mdx)\n\n:::nope\nx\n:::\n\n<Callout type="hint">x</Callout>\n');
    expect(summary(issues)).toEqual(['link-broken@1', 'directive-unknown@3', 'callout-type@7']);
  });
});
