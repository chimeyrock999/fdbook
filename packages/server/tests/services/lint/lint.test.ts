import { describe, expect, it } from 'vitest';
import { lintNote } from '#services/lint/lint.ts';
import type { DiagramProblem, LintIssue } from '#services/lint/types.ts';

const PAGES = ['index.mdx', 'guide/index.mdx', 'guide/intro.mdx', 'guide/setup.mdx', 'other/page.mdx'];
const ASSETS = ['docs/guide/demo.html', 'docs/guide/arch.svg', 'images/logo.png'];
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

describe('callouts', () => {
  it('accepts every fumadocs callout type and its aliases', () => {
    const types = ['info', 'warning', 'warn', 'error', 'success', 'idea', 'tip'];
    expect(lint([...types.map((type) => `<Callout type="${type}">x</Callout>\n`), '<Callout>x</Callout>\n'].join('\n'))).toEqual([]);
  });

  it('flags a type fumadocs does not know, such as a chimeyrock one', () => {
    const issues = lint('<Callout type="hint">x</Callout>\n\n<Callout type="example">x</Callout>\n');
    expect(summary(issues)).toEqual(['callout-type@1', 'callout-type@3']);
    expect(issues[0]?.message).toContain('hint');
  });

  it('flags a callout whose style is a string, and accepts a style object', () => {
    const source = '<Callout style="warning">x</Callout>\n\n<Callout type="tip" style={{ marginTop: 0 }}>x</Callout>\n\n```mdx\n<Callout style="warning">x</Callout>\n```\n';
    const issues = lint(source);
    expect(summary(issues)).toEqual(['callout-style@1']);
    expect(issues[0]?.message).toContain('`type`');
  });
});

describe('removed syntax', () => {
  // Directives and graph markers are no longer the site's: `:::note` is
  // text, and a component the site does not define is the build's to flag.
  it('reads directives as plain text and leaves unknown components alone', () => {
    const source = [
      ':::note',
      'x',
      ':::',
      '',
      '::youtube[clip]',
      '',
      'A :keyword[word] here.',
      '',
      '<Keyword id="k" />',
      '',
      '<HtmlEmbed src="/gone.html" />',
      '',
      '<Accordions><Accordion title="A" kind="tips">x</Accordion></Accordions>',
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
  it('accepts images that exist in public/', () => {
    expect(lint('![logo](/images/logo.png)\n\n![rel](./pic.png)\n\n![web](https://cdn.example.com/a.png)\n')).toEqual([]);
  });

  it('reads an image path as the browser asks for it, percent escapes decoded', () => {
    expect(lint('![a](/docs/guide/my%20pic.png)\n', { assets: [...ASSETS, 'docs/guide/my pic.png'] })).toEqual([]);
    expect(summary(lint('![a](/docs/guide/my%20pic.png)\n'))).toEqual(['asset-missing@1']);
  });

  it('flags a missing image', () => {
    const issues = lint('![a](/images/none.png)\n');
    expect(summary(issues)).toEqual(['asset-missing@1']);
    expect(issues[0]?.message).toContain('/images/none.png');
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
    const issues = lint('---\ntitle: T\ndescription: D\n---\n\n<Callout type="nope">x</Callout>\n');
    expect(summary(issues)).toEqual(['callout-type@6']);
  });

  it('reports a parse error with its position instead of throwing', () => {
    const issues = lint('# T\n\n<Callout type="note">\nunclosed\n');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: 'mdx-parse', severity: 'error' });
    expect(issues[0]?.start.line).toBeGreaterThan(0);
  });

  it('sorts issues by position', () => {
    const issues = lint('[a](./gone.mdx)\n\n_x_\n\n<Callout type="hint">x</Callout>\n');
    expect(summary(issues)).toEqual(['link-broken@1', 'emphasis-marker@3', 'callout-type@5']);
  });
});
