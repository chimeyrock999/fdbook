import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseMdxToDoc, serializeDocToMdx, type ParsedDoc } from '@fumadocs-editor/core';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../../server/config';
import { parseAccordions, withAccordionAttributes, withAccordionBody } from '../../../src/plugins/site-directives/accordions';
import { decorateSiteDirectives } from '../../../src/plugins/site-directives/decorate';
import { defined, describeDecoration, editorState, nodesOf, syntax, withNode } from '../../support/editor-state';
import { realNotes } from '../../support/notes';

const notes = await realNotes();

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

  it('rewrites one item\'s kind or title on its own line only', async () => {
    const [top, indented] = await groups();
    expect(withAccordionAttributes(top, 1, { kind: 'tip' }))
      .toBe(top.replace(':::accordion{kind="deep-dive" title="Deep dive"}', ':::accordion{kind="tip" title="Deep dive"}'));
    expect(withAccordionAttributes(top, 0, { title: 'Wide facts?' }))
      .toBe(top.replace('title="Open question"', 'title="Wide facts?"'));
    // The nested `:::note[Nested]` opener in item 2 is not an item.
    expect(parseAccordions(withAccordionAttributes(top, 1, { title: 'Dig' }))?.items.map((item) => item.title)).toEqual(['Open question', 'Dig']);
    expect(withAccordionAttributes(indented, 0, { kind: 'danger', title: 'Chú ý' }))
      .toBe(indented.replace('{kind="warning" title="Lưu ý"}', '{kind="danger" title="Chú ý"}'));
    expect(() => withAccordionAttributes(top, 2, { kind: 'tip' })).toThrow(/no accordion 2/);
  });

  it('keeps the quoting, order and spacing of the attributes it rewrites', () => {
    const group = (opener: string) => `::::accordions\r\n${opener}\r\nx\r\n:::\r\n::::`;
    const write = (opener: string, changes: { kind?: string; title?: string }) =>
      withAccordionAttributes(group(opener), 0, changes);
    expect(write(":::accordion{ title='A'  kind=tip }", { kind: 'note', title: 'B' })).toBe(group(":::accordion{ title='B'  kind=note }"));
    expect(write(':::accordion{title = "A"}', { title: 'B' })).toBe(group(':::accordion{title = "B"}'));
    // Missing attributes are added at the end, or in new braces.
    expect(write(':::accordion{title="A"}', { kind: 'tip' })).toBe(group(':::accordion{title="A" kind="tip"}'));
    expect(write(':::accordion{}', { kind: 'tip' })).toBe(group(':::accordion{kind="tip"}'));
    expect(write(':::accordion', { title: 'B' })).toBe(group(':::accordion{title="B"}'));
    // A title spelled as the label stays in the label.
    expect(write(':::accordion[A]{kind="tip"}', { title: 'B [x]' })).toBe(group(':::accordion[B \\[x\\]]{kind="tip"}'));
    // A quote in the new value switches the quoting, or is a reference.
    expect(write(':::accordion{title="A"}', { title: 'Say "hi"' })).toBe(group(`:::accordion{title='Say "hi"'}`));
    expect(write(':::accordion{title="A"}', { title: `It's "x"` })).toBe(group(`:::accordion{title="It's &quot;x&quot;"}`));
    expect(parseAccordions(write(':::accordion{title="A"}', { title: `It's "x"` }))?.items[0].title).toBe(`It's "x"`);
    expect(parseAccordions(write(':::accordion[A]', { title: 'B [x]' }))?.items[0].title).toBe('B [x]');
  });

  it('rewrites the attribute itself, never a word inside another value', () => {
    const group = (opener: string) => `::::accordions\n${opener}\nx\n:::\n::::`;
    const write = (opener: string, changes: { kind?: string; title?: string }) =>
      withAccordionAttributes(group(opener), 0, changes);
    expect(write(':::accordion{title="a kind b" kind}', { kind: 'tip' })).toBe(group(':::accordion{title="a kind b" kind="tip"}'));
    // The parser keeps the last of two, so that one is written.
    expect(parseAccordions(group(':::accordion{kind="tip" kind="note"}'))?.items[0].kind).toBe('note');
    expect(write(':::accordion{kind="tip" kind="note"}', { kind: 'warning' })).toBe(group(':::accordion{kind="tip" kind="warning"}'));
  });

  // mdast-util-directive decodes character references in attributes, and a
  // label is markdown: the card shows and writes the text the site shows.
  it('reads and writes titles as the site reads them', () => {
    const group = (opener: string) => `::::accordions\n${opener}\nx\n:::\n::::`;
    const title = (opener: string) => parseAccordions(group(opener))?.items[0].title;
    expect(title(':::accordion{title="Tom &amp; Jerry &#x2014; &lt;3"}')).toBe('Tom & Jerry \u2014 <3');
    expect(title(':::accordion[a\\*b &amp; c]')).toBe('a*b & c');
    const write = (opener: string, text: string) => withAccordionAttributes(group(opener), 0, { title: text });
    expect(write(':::accordion{title="A"}', 'R&D &amp; more')).toBe(group(':::accordion{title="R&D &amp;amp; more"}'));
    expect(title(':::accordion{title="R&D &amp;amp; more"}')).toBe('R&D &amp; more');
    expect(write(':::accordion[A]', 'use *this* & [that]')).toBe(group(':::accordion[use \\*this\\* \\& \\[that\\]]'));
    expect(title(':::accordion[use \\*this\\* \\& \\[that\\]]')).toBe('use *this* & [that]');
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

  // One test per note, each well inside the default timeout; the last one
  // checks the total (tests in a file run in order).
  describe('in the real notes', () => {
    let items = 0;

    it.each(notes)('reads every group in $path and writes its bodies, kinds and titles back unchanged', ({ source }) => {
      for (const { node } of nodesOf(editorState(source), 'verbatim')) {
        const value = String(node.attrs.value);
        if (!/^:{3,}accordions/.test(value)) continue;
        const group = defined(parseAccordions(value));
        expect(group.items.length).toBe((value.match(/^\s*:::accordion\b/gm) ?? []).length);
        group.items.forEach((item, index) => {
          expect(item.title).not.toBe('');
          expect(withAccordionBody(value, index, item.body)).toBe(value);
          expect(withAccordionAttributes(value, index, { title: item.title, ...(item.kind && { kind: item.kind }) })).toBe(value);
        });
        items += group.items.length;
      }
    });

    it('finds the accordion items', () => {
      expect(items).toBeGreaterThan(40);
    });
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
