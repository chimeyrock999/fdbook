import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseMdxToDoc, serializeDocToMdx, type ParsedDoc } from '@fumadocs-editor/core';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../../server/config';
import { parseAccordions, withAccordionBody } from '../../../src/plugins/site-directives/accordions';
import { decorateSiteDirectives } from '../../../src/plugins/site-directives/decorate';
import { defined, describeDecoration, editorState, nodesOf, syntax, withNode } from '../../support/editor-state';
import { realNotes } from '../../support/notes';

const fixture = () => readFile(join(repoRoot, 'tools/notes-studio/src/plugins/site-directives/fixtures/site-directives.mdx'), 'utf8');

async function groups() {
  return nodesOf(editorState(await fixture()), 'verbatim').map(({ node }) => String(node.attrs.value));
}

describe('accordion groups', () => {
  it('reads the items with their kind, title and body', async () => {
    const [top, indented] = await groups();
    expect(parseAccordions(top)?.items).toEqual([
      { title: 'Open question', kind: 'question', body: 'Is a wide fact table a problem?\n\n- Yes, when steps change.' },
      { title: 'Deep dive', kind: 'deep-dive', body: ':::note[Nested]\nA callout inside an accordion.\n:::' },
    ]);
    expect(parseAccordions(indented)?.items).toEqual([
      { title: 'Lưu ý', kind: 'warning', body: 'Indented body.\n\nSecond paragraph.' },
    ]);
  });

  it('rewrites one body and keeps every other byte', async () => {
    const [top, indented] = await groups();
    expect(withAccordionBody(top, 0, 'New body.')).toBe(top.replace('Is a wide fact table a problem?\n\n- Yes, when steps change.', 'New body.'));
    expect(withAccordionBody(indented, 0, 'One.\n\nTwo.')).toBe(indented.replace('Indented body.\n\nSecond paragraph.', 'One.\n\nTwo.'));
    expect(withAccordionBody('::::accordions\r\n:::accordion{title="A"}\r\nx\r\n:::\r\n::::', 0, 'y\nz'))
      .toBe('::::accordions\r\n:::accordion{title="A"}\r\ny\r\nz\r\n:::\r\n::::');
    expect(() => withAccordionBody(top, 2, 'x')).toThrow(/no accordion 2/);
  });

  // What the card's textarea does, through the editor's own parse and save:
  // only the edited body changes, and a group inside a list keeps its indent.
  it('saves an edited body into the note', async () => {
    const source = await fixture();
    const parsed = parseMdxToDoc(source, syntax);
    // A changed node is a new object, as after setNodeMarkup: the serializer
    // writes a top-level block it does not know again and copies the rest.
    const content = defined(parsed.doc.content);
    const at = content.findIndex((block) => block.type === 'orderedList');
    const list = structuredClone(content[at]);
    content[at] = list;
    const find = (node: ParsedDoc['doc']): ParsedDoc['doc'] | undefined =>
      node.type === 'verbatim' ? node : node.content?.map(find).find(Boolean);
    const group = defined(find(list));
    group.attrs = { ...group.attrs, value: withAccordionBody(String(group.attrs?.value), 0, 'One.\n\nTwo.') };
    const saved = serializeDocToMdx(parsed.doc, parsed.snapshot, syntax);
    expect(saved).toContain('   :::accordion{kind="warning" title="Lưu ý"}\n   One.\n\n   Two.\n   :::\n   ::::');
    // Blocks around the edited list are copied as they were; the list itself
    // is written by the editor (which writes it tight).
    expect(saved.startsWith(source.slice(0, source.indexOf('1. A list item')))).toBe(true);
    expect(saved.endsWith(source.slice(source.indexOf('::youtube')))).toBe(true);
  });

  it('reads every group in the real notes and writes it back unchanged', async () => {
    let items = 0;
    for (const { path, source } of await realNotes()) {
      for (const { node } of nodesOf(editorState(source), 'verbatim')) {
        const value = String(node.attrs.value);
        if (!/^:{3,}accordions/.test(value)) continue;
        const group = defined(parseAccordions(value), path);
        expect(group.items.length, path).toBe((value.match(/^\s*:::accordion\b/gm) ?? []).length);
        group.items.forEach((item, index) => {
          expect(item.title, path).not.toBe('');
          expect(withAccordionBody(value, index, item.body), path).toBe(value);
        });
        items += group.items.length;
      }
    }
    expect(items).toBeGreaterThan(40);
  });
});

describe('site directive decorations', () => {
  it('draws a card over each accordion group and YouTube embed', async () => {
    const state = editorState(await fixture());
    const found = decorateSiteDirectives(state).map(describeDecoration);
    const blocks = nodesOf(state, 'verbatim');
    expect(blocks).toHaveLength(3);
    expect(found.filter((item) => item.class === 'studio-hidden').map((item) => item.from)).toEqual(blocks.map(({ pos }) => pos));
    expect(found.flatMap((item) => (item.widget ? [item.widget.split(':')[0]] : []))).toEqual(['accordions', 'accordions', 'youtube']);
  });

  it('shows the source of a selected block', async () => {
    const state = editorState(await fixture());
    const [first] = nodesOf(state, 'verbatim');
    expect(decorateSiteDirectives(withNode(state, first.pos)).map(describeDecoration).find((item) => item.from === first.pos)).toBeUndefined();
  });

  it('leaves other verbatim blocks alone', () => {
    const state = editorState('::::steps\n:::step[One]\nx\n:::\n::::\n');
    expect(nodesOf(state, 'verbatim')).toHaveLength(1);
    expect(decorateSiteDirectives(state)).toEqual([]);
  });
});
