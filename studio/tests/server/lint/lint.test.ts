import { describe, expect, it } from 'vitest';
import { lintNote } from '../../../server/lint/lint';
import type { DiagramProblem, LintIssue } from '../../../server/lint/types';

const PAGES = ['index.mdx', 'guide/index.mdx', 'guide/intro.mdx', 'guide/setup.mdx', 'other/page.mdx'];
const ASSETS = ['notes/guide/demo.html', 'notes/guide/arch.svg', 'images/logo.png'];
// Diagrams by src, and what keeps each from drawing cleanly.
const DIAGRAMS: Record<string, DiagramProblem | null> = {
  'guide/flow': null,
  'guide/broken': { severity: 'error', message: '[structure/unknown-endpoint] Edge "ab" ends at "ghost"' },
  'guide/tight': { severity: 'warning', message: '[layout/node-overlap] Nodes "a" and "b" are less than 8px apart.' },
};

function lint(source: string, { path = 'guide/intro.mdx', pages = PAGES, assets = ASSETS } = {}) {
  return lintNote(source, {
    path,
    pages: new Set(pages),
    assetExists: (asset) => assets.includes(asset),
    diagramProblem: (src) => (src in DIAGRAMS ? DIAGRAMS[src] : 'missing'),
  });
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

  it('flags a callout whose style is a string, and accepts a style object', () => {
    const source = '<Callout style="warning">x</Callout>\n\n<Callout type="tip" style={{ marginTop: 0 }}>x</Callout>\n\n```mdx\n<Callout style="warning">x</Callout>\n```\n';
    const issues = lint(source);
    expect(summary(issues)).toEqual(['callout-style@1']);
    expect(issues[0]?.message).toContain('`type`');
  });

  it('flags an unknown accordion kind, in a directive or JSX', () => {
    const source = '::::accordions\n:::accordion{title="Q" kind="faq"}\na\n:::\n::::\n\n<Accordions><Accordion title="A" kind="tips">x</Accordion></Accordions>\n';
    const issues = lint(source);
    expect(summary(issues)).toEqual(['accordion-kind@2', 'accordion-kind@7']);
    expect(issues[0]?.message).toContain('the page fails to render');
  });

  it('flags what a group decides for its accordions: their type, one value twice, a defaultValue no item has', () => {
    const source = [
      '::::accordions{type="single" defaultValue="Missing"}',
      ':::accordion[One]{type="multiple"}', 'a', ':::',
      ':::accordion{title="One"}', 'b', ':::',
      ':::accordion[Two]{value="One"}', 'c', ':::',
      '::::',
      '',
      ':::accordion[Alone]{type="multiple"}', 'd', ':::',
    ].join('\n');
    const issues = lint(source);
    expect(summary(issues)).toEqual(['accordion-group@1', 'accordion-group@2', 'accordion-group@5', 'accordion-group@8']);
    expect(issues.map((issue) => issue.severity)).toEqual(['warning', 'warning', 'warning', 'warning']);
    expect(issues[0]?.message).toContain('`Missing`');
    expect(issues[1]?.message).toContain('`type` on `::::accordions`');
    expect(issues[2]?.message).toContain('`One`');
  });

  it('counts an <Accordion> written in a group as one of its items', () => {
    const source = [
      '::::accordions{type="single" defaultValue="Jsx"}',
      '<Accordion title="Jsx">a</Accordion>',
      '',
      ':::accordion[Jsx]', 'b', ':::',
      '::::',
      '',
      '::::accordions{type="multiple" defaultValue="A,B"}',
      ':::accordion[A]', 'a', ':::',
      ':::accordion[B]', 'b', ':::',
      '::::',
    ].join('\n');
    const issues = lint(source);
    expect(summary(issues)).toEqual(['accordion-group@4', 'accordion-group@9']);
    expect(issues[1]?.message).toContain('names one item');
  });

  it('accepts a group whose defaultValue names an item by title or value', () => {
    const source = [
      '::::accordions{type="single" defaultValue="Second"}',
      ':::accordion[First]', 'a', ':::',
      ':::accordion[Two]{value="Second"}', 'b', ':::',
      '::::',
      '',
      '::::accordions{type="multiple" defaultValue="First"}',
      ':::accordion{title="First" kind="question"}', 'a', ':::',
      '::::',
    ].join('\n');
    expect(lint(source)).toEqual([]);
  });
});

describe('links', () => {
  it('accepts links that reach a page', () => {
    const source = [
      '[a](./setup.mdx) [b](./setup.mdx#step-2) [c](../other/page.mdx) [d](./index.mdx)',
      '[e](/docs/guide/setup) [f](/docs/guide/) [g](/docs) [h](#local) [i](https://example.com)',
      '[j](./setup) [k](mailto:a@b.c) [l](/resume)',
    ].join('\n');
    expect(lint(source)).toEqual([]);
  });

  it('resolves an extensionless relative link against the page URL, as the browser does', () => {
    // guide/intro.mdx is served at /docs/guide/intro, so ./x is /docs/guide/x.
    expect(lint('[x](./setup)\n')).toEqual([]);
    expect(summary(lint('[x](./setup)\n', { path: 'guide/index.mdx' }))).toEqual(['link-broken@1']);
  });

  it('flags relative and /docs links that reach no page', () => {
    const issues = lint('[a](./missing.mdx) [b](../nope/page.mdx)\n\n[c](/docs/guide/missing#x) [d](./missing)\n');
    expect(summary(issues)).toEqual(['link-broken@1', 'link-broken@1', 'link-broken@3', 'link-broken@3']);
    expect(issues[0]?.message).toContain('./missing.mdx');
  });

  it('flags a query on a relative .mdx link, which the site does not strip', () => {
    // source.resolveHref looks up `setup.mdx?tab=a` as a file name; the browser then gets /docs/guide/setup.mdx.
    expect(summary(lint('[x](./setup.mdx?tab=a) [y](./setup.mdx#a)\n'))).toEqual(['link-broken@1']);
  });

  it('decodes a relative link before the file lookup, as fumadocs does', () => {
    // getPageByHref runs decodeURI on ./ and ../ links; micromark encodes `<./my note.mdx>`.
    const pages = [...PAGES, 'guide/my note.mdx'];
    expect(lint('[x](<./my note.mdx>) [y](./my%20note.mdx)\n', { pages })).toEqual([]);
    expect(summary(lint('[x](<./other note.mdx>)\n', { pages }))).toEqual(['link-broken@1']);
  });

  it('checks link definitions too', () => {
    expect(summary(lint('[x][ref]\n\n[ref]: ./missing.mdx\n'))).toEqual(['link-broken@3']);
  });
});

describe('assets', () => {
  it('accepts assets that exist in public/, ignoring query and hash', () => {
    const source = [
      '<HtmlEmbed src="/docs/guide/demo.html?embed=1" />',
      '',
      '<SvgDiagram src="/docs/guide/arch.svg" />',
      '',
      '::html{src="/docs/guide/demo.html"}',
      '',
      '::svg{src="/docs/guide/arch.svg#x"}',
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

  it('reads an image path as the browser asks for it, percent escapes decoded', () => {
    expect(lint('![a](/docs/guide/my%20pic.png)\n', { assets: [...ASSETS, 'notes/guide/my pic.png'] })).toEqual([]);
    expect(summary(lint('![a](/docs/guide/my%20pic.png)\n'))).toEqual(['asset-missing@1']);
  });

  it('flags missing assets and embeds with no source', () => {
    const source = '<HtmlEmbed src="/docs/guide/gone.html" />\n\n::diagram{src="/docs/x.svg"}\n\n![a](/images/none.png)\n\n<HtmlEmbed title="t" />\n';
    expect(summary(lint(source))).toEqual(['asset-missing@1', 'asset-missing@3', 'asset-missing@5', 'asset-missing@7']);
  });
});

describe('diagrams', () => {
  it('accepts a <Diagram> that draws cleanly', () => {
    expect(lint('<Diagram src="guide/flow" caption="Flow" />\n')).toEqual([]);
  });

  it('flags a <Diagram> with no src or no file', () => {
    expect(summary(lint('<Diagram src="guide/gone" />\n\n<Diagram title="t" />\n'))).toEqual(['asset-missing@1', 'asset-missing@3']);
  });

  it('says why a diagram shows a placeholder, and warns of one that draws with a layout problem', () => {
    const issues = lint('<Diagram src="guide/broken" />\n\n<Diagram src="guide/tight" />\n');
    expect(issues.map((issue) => [issue.rule, issue.severity])).toEqual([['diagram-invalid', 'error'], ['diagram-invalid', 'warning']]);
    expect(issues[0].message).toContain('unknown-endpoint');
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

describe('emphasis markers', () => {
  it('warns on `_` emphasis and `__` strong, over the whole node', () => {
    const issues = lint('An _a_ and a __b__.\n');
    expect(summary(issues)).toEqual(['emphasis-marker@1', 'emphasis-marker@1']);
    expect(issues[0]).toMatchObject({
      severity: 'warning',
      start: { line: 1, column: 4, offset: 3 },
      end: { line: 1, column: 7, offset: 6 },
    });
    expect(issues[0]?.message).toContain('*text*');
    expect(issues[1]).toMatchObject({ start: { line: 1, column: 14, offset: 13 }, end: { line: 1, column: 19, offset: 18 } });
    expect(issues[1]?.message).toContain('**text**');
  });

  it('accepts `*` and `**`, nested or not', () => {
    expect(lint('An *a*, a **b** and ***c***.\n\n*x **y** z*\n')).toEqual([]);
  });

  it('flags only the inner `_` node of a nested pair', () => {
    expect(lint('*a _b_ c*\n')).toMatchObject([{ rule: 'emphasis-marker', start: { offset: 3 }, end: { offset: 6 } }]);
  });

  it('leaves underscores that are not emphasis alone', () => {
    const source = [
      'snake_case_name and foo_bar_baz.',
      '',
      'Code `_code_` and [link](a_b_c) and $a_b$.',
      '',
      '```',
      '_fenced_',
      '```',
    ].join('\n');
    expect(lint(source, { pages: [...PAGES, 'guide/a_b_c.mdx'] })).toEqual([]);
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
