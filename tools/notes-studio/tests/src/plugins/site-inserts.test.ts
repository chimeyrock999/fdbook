import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { join } from 'node:path';
import { parseMdxToDoc } from '@fumadocs-editor/core';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../../server/config';
import { editorConfig } from '../../../src/plugins';
import { INSERT_PREFIX } from '../../../src/plugins/site-inserts';
import { syntax } from '../../support/editor-state';

// The slash menu's inserts live in tests/src/plugins/slash-menu.test.tsx;
// these check the specs that carry them.
describe('insert-only specs', () => {
  const inserts = editorConfig.components.filter((spec) => spec.name.startsWith(INSERT_PREFIX));

  it('are registered for every insert', () => {
    expect(inserts.map((spec) => spec.label)).toEqual([
      'Keyword', 'Tag', 'Graph heading', 'Accordions (directive)', 'Tabs (directive)', 'Steps (directive)', 'YouTube (directive)',
    ]);
  });

  // Their node types exist only so the slash menu lists them: no note may
  // parse into one, or it would render as nothing.
  it('never match anything in the notes', async () => {
    const types = new Set(inserts.map((spec) => spec.name.replace(/\W/g, '_')));
    const found: string[] = [];
    const visit = (node: { type?: string; content?: unknown[] }, path: string) => {
      if (node.type && types.has(node.type)) found.push(`${path}: ${node.type}`);
      for (const child of node.content ?? []) visit(child as typeof node, path);
    };
    let count = 0;
    for await (const path of glob('content/notes/**/*.mdx', { cwd: repoRoot })) {
      const source = await readFile(join(repoRoot, path), 'utf8');
      expect(source.includes(`<${INSERT_PREFIX}`), path).toBe(false);
      visit(parseMdxToDoc(source, syntax).doc, path);
      count++;
    }
    expect(count).toBeGreaterThan(50);
    expect(found).toEqual([]);
  });
});
