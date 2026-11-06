import { parseMdxToDoc, serializeDocToMdx } from '@fumadocs-editor/core';
import { describe, expect, it } from 'vitest';
import { editorConfig } from '#plugins/index.ts';
import { INSERT_PREFIX } from '#plugins/site-inserts/index.tsx';
import { syntax } from '#tests/support/editor-state.ts';
import { realNotes } from '@fdbook/testing/notes.ts';

const notes = await realNotes();

// The slash menu's inserts live in tests/src/plugins/slash-menu.test.tsx;
// these check the specs that carry them.
describe('insert-only specs', () => {
  const inserts = editorConfig.components.filter((spec) => spec.name.startsWith(INSERT_PREFIX));

  it('are registered for every insert', () => {
    expect(inserts.map((spec) => spec.label)).toEqual([
      'Keyword', 'Tag', 'Graph heading', 'Accordions (directive)', 'Tabs (directive)', 'Steps (directive)', 'YouTube (directive)',
      'Mermaid diagram',
    ]);
  });

  // A Mermaid diagram is the editor's own code block, which draws the
  // preview; it is written as the plain fence the notes use.
  it('inserts a Mermaid diagram as a mermaid code block', () => {
    const spec = inserts.find((candidate) => candidate.label === 'Mermaid diagram');
    const block = spec?.insert?.(new Map());
    expect(block).toMatchObject({ type: 'codeBlock', attrs: { language: 'mermaid' } });
    const doc = { type: 'doc', content: [block as object] };
    expect(serializeDocToMdx(doc, undefined, syntax)).toBe('```mermaid\nflowchart LR\n    A[Start] --> B[End]\n```\n');
  });

  // Their node types exist only so the slash menu lists them: no note may
  // parse into one, or it would render as nothing.
  // One test per note, each well inside the default timeout.
  it.each(notes)('never match anything in $path', ({ source }) => {
    const types = new Set(inserts.map((spec) => spec.name.replace(/\W/g, '_')));
    const found: string[] = [];
    const visit = (node: { type?: string; content?: unknown[] }) => {
      if (node.type && types.has(node.type)) found.push(node.type);
      for (const child of node.content ?? []) visit(child as typeof node);
    };
    expect(source.includes(`<${INSERT_PREFIX}`)).toBe(false);
    visit(parseMdxToDoc(source, syntax).doc);
    expect(found).toEqual([]);
  });

  it('read every note', () => {
    // A top-level page and one in a folder: the glob reaches both.
    expect(notes.map((note) => note.path)).toEqual(expect.arrayContaining(['content/docs/index.mdx', 'content/docs/guide/using.mdx']));
  });
});
