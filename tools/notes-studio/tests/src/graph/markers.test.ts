import { parseMdxToDoc, serializeDocToMdx } from '@fumadocs-editor/core';
import { Node } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection, type Transaction } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { addGraphMeta, defaults, graphMetaTarget, markerAt, updateMarker, withAttributes, wrapRange, wrapSelection } from '../../../src/graph/markers';
import { defined, schema, syntax } from '../../support/editor-state';

// A note as the editor holds it, with the snapshot that keeps unedited
// blocks byte for byte when it is written back.
function open(source: string) {
  const parsed = parseMdxToDoc(source, syntax);
  const state = EditorState.create({ doc: Node.fromJSON(schema, parsed.doc) });
  const write = (doc: Node) => serializeDocToMdx(doc.toJSON() as typeof parsed.doc, parsed.snapshot, syntax);
  return { state, write };
}

// The document position of `needle` (the n-th match) in the text.
function at(state: EditorState, needle: string, nth = 0) {
  let found = -1;
  let seen = 0;
  state.doc.descendants((node, pos) => {
    if (found !== -1 || !node.isText) return;
    let index = (node.text ?? '').indexOf(needle);
    while (index !== -1) {
      if (seen++ === nth) {
        found = pos + index;
        return;
      }
      index = (node.text ?? '').indexOf(needle, index + 1);
    }
  });
  if (found === -1) throw new Error(`no "${needle}"`);
  return found;
}

function select(state: EditorState, needle: string, nth = 0) {
  const from = at(state, needle, nth);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, from + needle.length)));
}

function caret(state: EditorState, pos: number) {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

function applied(state: EditorState, tr: Transaction | null) {
  return state.apply(defined(tr, 'transaction'));
}

describe('slug defaults', () => {
  it('slugs the text and keeps it as the display name', () => {
    expect(defaults('Process Control Block (PCB)')).toEqual({ id: 'process-control-block-pcb', displayName: 'Process Control Block (PCB)' });
    expect(defaults(' Đồng bộ dữ liệu ')).toEqual({ id: 'dong-bo-du-lieu', displayName: 'Đồng bộ dữ liệu' });
  });
});

describe('withAttributes', () => {
  it('sets attributes in place, keeps their spelling and adds missing ones', () => {
    expect(withAttributes(' id="" displayName=""', { id: 'a', displayName: 'A' })).toBe(' id="a" displayName="A"');
    expect(withAttributes(' displayname="x" id=old kind="keyword"', { id: 'b', displayName: 'B' })).toBe(' displayname="B" id="b" kind="keyword"');
    expect(withAttributes('', { id: 'c', displayName: 'C' })).toBe('id="c" displayName="C"');
    expect(withAttributes(' id="a"', { displayName: 'Say "hi"' })).toBe(' id="a" displayName=\'Say "hi"\'');
    // A name that only starts another attribute's name is not it, nor is a
    // word inside another attribute's value.
    expect(withAttributes(' identity="x"', { id: 'y' })).toBe(' identity="x" id="y"');
    expect(withAttributes(' displayName="the id of" id="x"', { id: 'new' })).toBe(' displayName="the id of" id="new"');
    expect(withAttributes(" title='id=1' id=x", { id: 'y', displayName: 'Y' })).toBe(" title='id=1' id=\"y\" displayName=\"Y\"");
  });
});

describe('wrapSelection', () => {
  it('wraps the selected text as a Keyword with the default id', () => {
    const { state, write } = open('Mỗi process có một Process Control Block (PCB) lưu trạng thái.\n\nOther paragraph.\n');
    const next = applied(state, wrapSelection(select(state, 'Process Control Block (PCB)'), 'Keyword'));
    expect(write(next.doc)).toBe('Mỗi process có một <Keyword id="process-control-block-pcb" displayName="Process Control Block (PCB)">Process Control Block (PCB)</Keyword> lưu trạng thái.\n\nOther paragraph.\n');
    // The caret ends in the new keyword, so it is the marker there.
    expect(markerAt(next)).toMatchObject({ kind: 'Keyword', attrs: { id: 'process-control-block-pcb' }, text: 'Process Control Block (PCB)' });
  });

  it('leaves the outer whitespace out and keeps bold around the tags', () => {
    const { state, write } = open('A **fact table** here.\n');
    const next = applied(state, wrapSelection(select(state, 'fact table'), 'Tag'));
    expect(write(next.doc)).toBe('A **<Tag id="fact-table" displayName="fact table">fact table</Tag>** here.\n');

    // Bold that stops inside the selection stays inside the keyword.
    const split = open('**alpha** beta **gamma**\n');
    const all = split.state.apply(split.state.tr.setSelection(TextSelection.create(split.state.doc, 1, split.state.doc.content.size - 1)));
    const wrapped = write(applied(all, wrapSelection(all, 'Keyword')).doc);
    expect(wrapped).toBe('<Keyword id="alpha-beta-gamma" displayName="alpha beta gamma">**alpha** beta **gamma**</Keyword>\n');
    expect(parseMdxToDoc(wrapped, syntax).doc.content?.[0].content?.[0].marks).toEqual([{ type: 'mdxJsxTag', attrs: { self: false } }]);

    const spaced = open('One grain only.\n');
    expect(write(applied(spaced.state, wrapSelection(select(spaced.state, ' grain '), 'Keyword')).doc)).toBe(
      'One <Keyword id="grain" displayName="grain">grain</Keyword> only.\n',
    );
  });

  it('refuses selections a keyword cannot take', () => {
    const { state } = open('Two\n\nblocks and `code` and <Keyword id="k" displayName="K">kept</Keyword> and :keyword[x]{id="x"}.\n\n```\nfenced\n```\n');
    const across = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at(state, 'Two'), at(state, 'blocks') + 3)));
    expect(wrapRange(across)).toBeNull();
    expect(wrapRange(select(state, 'code'))).toBeNull();
    expect(wrapRange(select(state, 'kept'))).toBeNull();
    const intoTag = at(state, 'kept');
    expect(wrapRange(state.apply(state.tr.setSelection(TextSelection.create(state.doc, intoTag - 10, intoTag))))).toBeNull();
    expect(wrapRange(select(state, 'fenced'))).toBeNull();
    expect(wrapRange(select(state, ' and ', 1))).toEqual({ from: at(state, ' and ', 1) + 1, to: at(state, ' and ', 1) + 4, text: 'and' });
    const blank = at(state, ' and ', 1);
    expect(wrapRange(state.apply(state.tr.setSelection(TextSelection.create(state.doc, blank, blank + 1))))).toBeNull();
    expect(wrapRange(caret(state, at(state, 'blocks')))).toBeNull();
    expect(wrapRange(select(state, 'blocks'))).toEqual({ from: at(state, 'blocks'), to: at(state, 'blocks') + 6, text: 'blocks' });
  });
});

describe('addGraphMeta', () => {
  it('adds :graph-meta from the heading title at its end', () => {
    const { state, write } = open('## Intro\n\n### Yet Another Resource Negotiator\n\nYARN.\n');
    const inHeading = caret(state, at(state, 'Negotiator') + 3);
    expect(graphMetaTarget(inHeading)?.text).toBe('Yet Another Resource Negotiator');
    const next = applied(inHeading, addGraphMeta(inHeading));
    expect(write(next.doc)).toBe('## Intro\n\n### Yet Another Resource Negotiator :graph-meta{id="yet-another-resource-negotiator" displayName="Yet Another Resource Negotiator"}\n\nYARN.\n');
    expect(markerAt(next)).toMatchObject({ kind: 'GraphMeta', text: 'Yet Another Resource Negotiator' });
    // Once there, the heading takes no second one.
    expect(addGraphMeta(next)).toBeNull();
  });

  it('only works in a heading with a title', () => {
    const { state } = open('Paragraph.\n\n### :graph-meta{id="x" displayName="X"}\n');
    expect(addGraphMeta(caret(state, at(state, 'Paragraph') + 2))).toBeNull();
  });
});

describe('markerAt and updateMarker', () => {
  const NOTE = [
    'Một <Keyword id="process" displayName="process">**process**</Keyword> và <Tag id="fact" displayName="Fact">fact</Tag>.',
    '',
    'Mixed <Keyword id="mixed" displayName="Mixed">**mi**xed</Keyword> marks.',
    '',
    'Atom :keyword[Registers]{id="registers" displayName="Registers"} here.',
    '',
    '### Hadoop Overview :graph-meta{id="hadoop-overview" displayName="Hadoop"}',
    '',
    'Self <GraphMeta id="grain" displayName="Grain" kind="keyword" /> marker.',
    '',
  ].join('\n');

  it('finds the marker at the caret or the selected atom', () => {
    const { state } = open(NOTE);
    expect(markerAt(caret(state, at(state, 'fact') + 2))).toMatchObject({ kind: 'Tag', text: 'fact', content: { type: 'range' } });
    // Bold all along can be rewritten in bold; part bold cannot.
    expect(markerAt(caret(state, at(state, 'process', 0) + 1))).toMatchObject({ kind: 'Keyword', text: 'process', content: { type: 'range' } });
    expect(markerAt(caret(state, at(state, 'xed', 2) + 1))).toMatchObject({ kind: 'Keyword', text: 'mixed', content: null });
    expect(markerAt(caret(state, at(state, 'Atom')))).toBeNull();
    let atom = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'verbatimInline' && atom === -1) atom = pos;
    });
    expect(markerAt(state.apply(state.tr.setSelection(NodeSelection.create(state.doc, atom))))).toMatchObject({
      kind: 'Keyword', text: 'Registers', attrs: { id: 'registers' }, content: { type: 'label' },
    });
    expect(markerAt(caret(state, at(state, 'Overview')))).toMatchObject({ kind: 'GraphMeta', text: 'Hadoop Overview', attrs: { displayName: 'Hadoop' } });
    expect(markerAt(caret(state, at(state, 'id="grain"')))).toMatchObject({ kind: 'GraphMeta', attrs: { id: 'grain' }, text: '' });
  });

  it('rewrites only the marker it edits', () => {
    const { state, write } = open(NOTE);
    const lines = NOTE.split('\n');
    const edit = (pos: number, values: { id: string; displayName: string; text: string }, node = false) => {
      const placed = node
        ? state.apply(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
        : caret(state, pos);
      return write(placed.apply(updateMarker(placed, defined(markerAt(placed), 'marker'), values)).doc).split('\n');
    };

    const tag = edit(at(state, 'fact') + 1, { id: 'fact-table', displayName: 'Fact table', text: 'fact tables' });
    expect(tag[0]).toBe('Một <Keyword id="process" displayName="process">**process**</Keyword> và <Tag id="fact-table" displayName="Fact table">fact tables</Tag>.');
    expect(tag.slice(1)).toEqual(lines.slice(1));

    expect(edit(at(state, 'process', 0) + 1, { id: 'proc', displayName: 'Process', text: 'other' })[0]).toBe(
      'Một <Keyword id="proc" displayName="Process">**other**</Keyword> và <Tag id="fact" displayName="Fact">fact</Tag>.',
    );
    // Text that cannot be rewritten as one run stays.
    expect(edit(at(state, 'xed', 2) + 1, { id: 'mixed', displayName: 'Mixed', text: 'other' })[2]).toBe(lines[2]);

    let atom = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'verbatimInline' && atom === -1) atom = pos;
    });
    expect(edit(atom, { id: 'registers', displayName: 'CPU registers', text: 'Registers' }, true)[4]).toBe(
      'Atom :keyword[Registers]{id="registers" displayName="CPU registers"} here.',
    );
    expect(edit(atom, { id: 'regs', displayName: 'Regs', text: 'CPU [regs]' }, true)[4]).toBe(
      'Atom :keyword[CPU \\[regs\\]]{id="regs" displayName="Regs"} here.',
    );

    const heading = edit(at(state, 'Overview'), { id: 'hadoop', displayName: 'Hadoop', text: 'Hadoop at a glance' });
    expect(heading[6]).toBe('### Hadoop at a glance :graph-meta{id="hadoop" displayName="Hadoop"}');
    expect(heading.filter((_, index) => index !== 6)).toEqual(lines.filter((_, index) => index !== 6));

    expect(edit(at(state, 'id="grain"'), { id: 'grain-2', displayName: 'Grain', text: '' })[8]).toBe(
      'Self <GraphMeta id="grain-2" displayName="Grain" kind="keyword" /> marker.',
    );
  });

  function atomState(source: string) {
    const opened = open(source);
    let atom = -1;
    opened.state.doc.descendants((node, pos) => {
      if (node.type.name === 'verbatimInline' && atom === -1) atom = pos;
    });
    return { ...opened, state: opened.state.apply(opened.state.tr.setSelection(NodeSelection.create(opened.state.doc, atom))) };
  }

  // Like a JSX keyword with mixed formatting: the label is read, never
  // rewritten, so its Markdown stays.
  it('keeps a directive label that holds Markdown', () => {
    const { state, write } = atomState('Text :keyword[**Big** data]{id="big-data" displayName="Big data"} end.\n');
    const marker = defined(markerAt(state));
    expect(marker).toMatchObject({ text: 'Big data', content: null });
    expect(write(state.apply(updateMarker(state, marker, { id: 'big', displayName: 'Big', text: 'Big data set' })).doc)).toBe(
      'Text :keyword[**Big** data]{id="big" displayName="Big"} end.\n',
    );
  });

  // A typed label is escaped so the site shows it as typed, and reads back
  // as the same text.
  it('escapes Markdown in a new directive label and reads it back', () => {
    const typed = 'a*b* and `x` \\ y_z [1]';
    const { state, write } = atomState(':keyword[data]{id="d" displayName="D"}\n');
    const written = write(state.apply(updateMarker(state, defined(markerAt(state)), { id: 'd', displayName: 'D', text: typed })).doc);
    expect(written).toBe(':keyword[a\\*b\\* and \\`x\\` \\\\ y\\_z \\[1\\]]{id="d" displayName="D"}\n');
    const again = atomState(written);
    expect(markerAt(again.state)).toMatchObject({ text: typed, content: { type: 'label' } });
  });

  // An attribute value cannot hold both quote kinds: double quotes become
  // single ones (README, Graph markers).
  it('quotes a value with both quote kinds by turning " into \'', () => {
    expect(withAttributes('', { displayName: 'He said "it\'s"' })).toBe('displayName="He said \'it\'s\'"');
  });

  // The fields show the text without its outer spaces; unchanged, it is not
  // written back without them.
  it('keeps the spaces inside a keyword when only the id changes', () => {
    const { state, write } = open('<Keyword id="a" displayName="A">Alpha </Keyword>next\n');
    const placed = caret(state, at(state, 'Alpha') + 1);
    const marker = defined(markerAt(placed));
    expect(marker.text).toBe('Alpha');
    expect(write(placed.apply(updateMarker(placed, marker, { id: 'b', displayName: 'A', text: marker.text })).doc)).toBe(
      '<Keyword id="b" displayName="A">Alpha </Keyword>next\n',
    );
  });
});
