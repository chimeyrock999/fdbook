// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Markdown } from '#features/agents/Markdown.tsx';
import { safeHref } from '#features/agents/safe-href.ts';

afterEach(cleanup);

const draw = (text: string) => render(<Markdown text={text} className="studio-agent-message" />).container.firstElementChild as HTMLElement;

const REPLY = [
  '> Auto Loader reads by **checkpoint**.',
  '',
  '1. Fix *section 2*',
  '2. Add `schemaLocation`',
  '',
  '- [x] done',
  '',
  '```python',
  'spark.readStream.format("cloudFiles")',
  '```',
  '',
  '| Way | Reads by |',
  '| :-- | --: |',
  '| Auto Loader | checkpoint |',
  '',
  'See [the docs](https://docs.databricks.com) or ~~not this~~.',
].join('\n');

describe('agent replies as markdown', () => {
  it('draws quotes, emphasis, lists, code, tables and links, not their markers', () => {
    const root = draw(REPLY);
    expect(root.querySelector('blockquote strong')?.textContent).toBe('checkpoint');
    expect([...root.querySelectorAll('ol > li')].map((item) => item.textContent)).toEqual(['Fix section 2', 'Add schemaLocation']);
    expect(root.querySelector('ol em')?.textContent).toBe('section 2');
    expect(root.querySelector<HTMLInputElement>('ul input[type="checkbox"]')?.checked).toBe(true);
    expect(root.querySelector('pre code')?.textContent).toBe('spark.readStream.format("cloudFiles")');
    expect(root.querySelector('pre code')?.getAttribute('data-lang')).toBe('python');
    expect([...root.querySelectorAll('th')].map((cell) => cell.textContent)).toEqual(['Way', 'Reads by']);
    expect(root.querySelector('td')?.textContent).toBe('Auto Loader');
    const link = root.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://docs.databricks.com');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(root.querySelector('del')?.textContent).toBe('not this');
    expect(root.textContent).not.toMatch(/\*\*|^>|```/);
    // A tight list holds its text without a paragraph.
    expect(root.querySelector('ol p')).toBeNull();
  });

  it('draws no HTML and no link that is not to the web or an email', () => {
    const root = draw('<img src=x onerror="alert(1)"> and <b>bold</b>\n\n[click](javascript:alert(1)) [data](data:text/html,x) ![pic](https://example.com/a.png) <script>alert(1)</script>');
    expect(root.querySelector('img, b, script')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror="alert(1)">');
    expect([...root.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(['https://example.com/a.png']);
    expect(root.textContent).toContain('click');
    expect(safeHref(' javascript:alert(1)')).toBeNull();
    expect(safeHref('MAILTO:a@b.c')).toBe('MAILTO:a@b.c');
  });

  it('draws a reply streamed in chunks as the whole reply, half a fence included', () => {
    let streamed = '';
    const { container, rerender } = render(<Markdown text="" className="studio-agent-message" />);
    for (const chunk of REPLY.match(/[\s\S]{1,7}/g) ?? []) {
      streamed += chunk;
      rerender(<Markdown text={streamed} className="studio-agent-message" />);
    }
    expect(container.innerHTML).toBe(draw(REPLY).outerHTML);
    // An unclosed fence is a code block to the end, not text that jumps later.
    expect(draw('Here:\n\n```ts\nconst a = 1').querySelector('pre code')?.textContent).toBe('const a = 1');
  });
});
