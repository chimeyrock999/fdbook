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
  it('offers fumadocs-ui components and Mermaid in the slash menu', async () => {
    const view = await mountVisual('Intro.\n\nx\n');
    const x = textAt(view.editor, 'x');
    act(() => { view.editor.chain().setTextSelection({ from: x, to: x + 1 }).insertContent('/').run(); });
    const items = await vi.waitFor(() => {
      const found = [...document.querySelectorAll('button')].map((button) => button.textContent);
      expect(found).toContain('Mermaid diagram');
      return found;
    });
    expect(items).toEqual(expect.arrayContaining(['Callout', 'Cards', 'Steps', 'Tabs', 'Accordions', 'Diagram', 'Mermaid diagram']));
  });

  it('inserts /mermaid as a mermaid code block', async () => {
    const view = await slash('Intro.\n\nx\n\nAfter.\n', 'mermaid');
    await view.written('Intro.\n\n```mermaid\nflowchart LR\n    A[Start] --> B[End]\n```\n\nAfter.\n');
  });

  it('puts the caret in a new Mermaid diagram and draws it', async () => {
    const view = await slash('Intro.\n\nx\n', 'mermaid');
    await vi.waitFor(() => { expect(view.editor.state.selection.$from.parent.type.name).toBe('codeBlock'); });
    expect(view.editor.state.selection.$from.parent.attrs.language).toBe('mermaid');
    // The editor draws the starter under the code.
    const diagram = await vi.waitFor(() => defined(view.container.querySelector('figure svg.pele-flowchart'), 'diagram'), { timeout: 10_000 });
    expect(diagram.textContent).toContain('Start');
  }, 20_000);

  // The menu matches labels only: "diagram" finds it next to FdBook's
  // Diagram, whose order follows the plugin folders.
  it('lists Mermaid diagram for /diagram', async () => {
    const view = await mountVisual('Intro.\n\nx\n');
    const x = textAt(view.editor, 'x');
    act(() => { view.editor.chain().setTextSelection({ from: x, to: x + 1 }).insertContent('/diagram').run(); });
    const items = await vi.waitFor(() => {
      const found = [...document.querySelectorAll('button')].map((button) => button.textContent);
      expect(found).toContain('Mermaid diagram');
      return found;
    });
    expect(items).toContain('Diagram');
  });
});
