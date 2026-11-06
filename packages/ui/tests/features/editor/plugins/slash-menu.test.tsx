// @vitest-environment jsdom
import { act, cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defined } from '#tests/support/editor-state.ts';
import { mountVisual, stubLayout, textAt } from '#tests/support/visual-editor.tsx';

beforeAll(stubLayout);
afterAll(() => { vi.unstubAllGlobals(); });
afterEach(cleanup);

// Types `/query` over the `x` in the note, moves `down` items in the menu and
// picks it with Enter, as a writer would.
async function slash(source: string, query: string, down = 0) {
  const view = await mountVisual(source);
  const x = textAt(view.editor, 'x');
  act(() => { view.editor.chain().setTextSelection({ from: x, to: x + 1 }).insertContent(`/${query}`).run(); });
  // The menu opens a moment after the text goes in.
  await vi.waitFor(() => {
    expect([...document.querySelectorAll('button')].some((button) => button.textContent.toLowerCase().includes(query))).toBe(true);
  });
  for (let step = 0; step < down; step++) view.key('ArrowDown');
  view.key('Enter');
  return view;
}

describe('slash-menu inserts', () => {
  it('offers the site syntax in the slash menu', async () => {
    const view = await mountVisual('Intro.\n\nx\n');
    const x = textAt(view.editor, 'x');
    act(() => { view.editor.chain().setTextSelection({ from: x, to: x + 1 }).insertContent('/').run(); });
    const items = await vi.waitFor(() => {
      const found = [...document.querySelectorAll('button')].map((button) => button.textContent);
      expect(found).toContain('Keyword');
      return found;
    });
    expect(items).toEqual(expect.arrayContaining([
      'Keyword', 'Tag', 'Graph heading', 'Accordions (directive)', 'Tabs (directive)', 'Steps (directive)', 'YouTube (directive)', 'YouTube', 'Mermaid diagram',
    ]));
  });

  it.each([
    ['tabs', 2, '::::tabs{items="Tab 1 | Tab 2"}\n:::tab[Tab 1]\nContent\n:::\n\n:::tab[Tab 2]\nContent\n:::\n::::'],
    ['steps', 1, '::::steps\n:::step[Step 1]\nContent\n:::\n\n:::step[Step 2]\nContent\n:::\n::::'],
    ['accordions', 1, '::::accordions{type="single"}\n:::accordion{kind="note" title="Title"}\nContent\n:::\n::::'],
    ['youtube', 0, '::youtube{url="" title=""}'],
    ['youtube', 1, '<YouTube url="" />'],
    ['graph', 0, '### Title :graph-meta{id="" displayName=""}'],
    ['mermaid', 0, '```mermaid\nflowchart LR\n    A[Start] --> B[End]\n```'],
  ])('inserts /%s (item %i) as the site writes it', async (query, down, block) => {
    const view = await slash('Intro.\n\nx\n\nAfter.\n', query, down);
    await view.written(`Intro.\n\n${block}\n\nAfter.\n`);
  });

  it('puts the caret in a new Mermaid diagram and draws it', async () => {
    const view = await slash('Intro.\n\nx\n', 'mermaid');
    await vi.waitFor(() => { expect(view.editor.state.selection.$from.parent.type.name).toBe('codeBlock'); });
    expect(view.editor.state.selection.$from.parent.attrs.language).toBe('mermaid');
    // The editor draws the starter under the code (Pele, as the site does).
    const diagram = await vi.waitFor(() => defined(view.container.querySelector('figure svg.pele-flowchart'), 'diagram'), { timeout: 10_000 });
    expect(diagram.textContent).toContain('Start');
  }, 20_000);

  // The menu matches labels only: "diagram" finds it next to SVG diagram,
  // whose order follows the plugin folders.
  it('lists Mermaid diagram for /diagram', async () => {
    const view = await mountVisual('Intro.\n\nx\n');
    const x = textAt(view.editor, 'x');
    act(() => { view.editor.chain().setTextSelection({ from: x, to: x + 1 }).insertContent('/diagram').run(); });
    const items = await vi.waitFor(() => {
      const found = [...document.querySelectorAll('button')].map((button) => button.textContent);
      expect(found).toContain('Mermaid diagram');
      return found;
    });
    expect(items).toContain('SVG diagram');
  });

  it('inserts a Keyword or Tag inline', async () => {
    const keyword = await slash('A x here.\n', 'keyword');
    await keyword.written('A <Keyword id="" displayName="">keyword</Keyword> here.\n');
    cleanup();
    const tag = await slash('A x here.\n', 'tag');
    await tag.written('A <Tag id="" displayName="">tag</Tag> here.\n');
  });

  it('draws <YouTube> as a card with its url', async () => {
    const view = await mountVisual('<YouTube url="https://youtu.be/abc" title="Lecture 1" />\n');
    const card = await vi.waitFor(() => {
      const found = view.container.querySelector('.studio-youtube');
      expect(found).not.toBeNull();
      return found;
    });
    expect(card?.querySelector('.studio-card-src')?.textContent).toBe('https://youtu.be/abc');
    expect(card?.textContent).toContain('Lecture 1');
  });
});
