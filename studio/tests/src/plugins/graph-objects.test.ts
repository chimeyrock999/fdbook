import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installRoot } from '../../../server/config';
import { keywordClassName, tagClassName } from '@site/components/graph-objects';
import { decorateGraphObjects, KEYWORD_CLASS, TAG_CLASS } from '../../../src/plugins/graph-objects/decorate';
import { attributes } from '../../../src/plugins/source-attributes';
import { defined, describeDecoration, editorState, nodesOf, withNode, withText } from '../../support/editor-state';
import { realNotes } from '../../support/notes';

const notes = await realNotes();

const fixture = () => readFile(join(installRoot, 'studio/src/plugins/graph-objects/fixtures/graph-objects.mdx'), 'utf8');

function decorations(state: Parameters<typeof decorateGraphObjects>[0]) {
  return decorateGraphObjects(state).map(describeDecoration);
}

function textOf(state: ReturnType<typeof editorState>, from: number, to: number) {
  return state.doc.textBetween(from, to);
}

describe('source attributes', () => {
  it('reads JSX and directive attributes', () => {
    expect(attributes(' id="a-b" displayName=\'B "c"\' kind=keyword plate')).toEqual({ id: 'a-b', displayName: 'B "c"', kind: 'keyword', plate: '' });
    expect(attributes('id="grain" displayName="Grain (fact)"')).toEqual({ id: 'grain', displayName: 'Grain (fact)' });
  });
});

describe('graph object decorations', () => {
  // The text takes the site's own classes, so a change to how
  // components/graph-objects.tsx draws a keyword shows in the Studio.
  it('styles keywords and tags with the classes of components/graph-objects.tsx', () => {
    expect(KEYWORD_CLASS).toBe(`studio-keyword ${keywordClassName}`);
    expect(TAG_CLASS).toBe(`studio-keyword studio-keyword-tag ${tagClassName}`);
    expect(tagClassName.split(' ')).toEqual(expect.arrayContaining(['rounded-full', 'underline']));
  });

  it('hides the tags of Keyword and Tag and styles their text', async () => {
    const state = editorState(await fixture());
    const found = decorations(state);
    const styled = found.filter((item) => item.class?.startsWith('studio-keyword'));
    expect(styled.map((item) => [item.class, textOf(state, item.from, item.to)])).toEqual([
      [KEYWORD_CLASS, 'business process'],
      [TAG_CLASS, 'fact'],
      [KEYWORD_CLASS, 'process'],
    ]);
    const hidden = found.filter((item) => item.class === 'studio-hidden' && item.to - item.from > 1);
    expect(hidden.map((item) => textOf(state, item.from, item.to))).toEqual([
      '<GraphMeta id="grain" displayName="Grain" kind="keyword" />',
      '<Keyword id="business-process" displayName="Business Process">',
      '</Keyword>',
      '<Tag id="fact" displayName="Fact">',
      '</Tag>',
      '<Keyword id="process" displayName="process">',
      '</Keyword>',
    ]);
  });

  it('draws markers and labels for GraphMeta and the text directives', async () => {
    const widgets = decorations(editorState(await fixture())).flatMap((item) => (item.widget ? [item.widget] : []));
    expect(widgets).toEqual([
      'graph-meta:text:Grain',
      'keyword:false:grain:Grain',
      'graph-meta:atom:Thread Pool',
      'keyword:true:fact tables:Fact Table',
    ]);
  });

  it('shows the source while the caret is inside', async () => {
    const state = editorState(await fixture());
    const keyword = defined(decorations(state).find((item) => item.class === KEYWORD_CLASS));
    const inside = decorations(withText(state, keyword.from + 2));
    expect(inside.find((item) => item.class === 'studio-hidden' && textOf(state, item.from, item.to).startsWith('<Keyword id="business'))).toBeUndefined();
    expect(inside.filter((item) => item.class === KEYWORD_CLASS)).toHaveLength(2);

    // Right after a hidden closing tag a Backspace would delete it unseen.
    const closing = defined(decorations(state).find((item) => item.class === 'studio-hidden' && textOf(state, item.from, item.to) === '</Keyword>'));
    expect(decorations(withText(state, closing.to)).filter((item) => item.class === 'studio-hidden' && item.from <= closing.from && item.to >= keyword.from - 1)).toEqual([]);

    const marker = defined(decorations(state).find((item) => item.widget === 'graph-meta:text:Grain'));
    expect(decorations(withText(state, marker.from + 1)).find((item) => item.widget === 'graph-meta:text:Grain')).toBeUndefined();

    const [atom] = nodesOf(state, 'verbatimInline');
    expect(decorations(withNode(state, atom.pos)).find((item) => item.from === atom.pos)).toBeUndefined();
  });

  // Every <Keyword>, <GraphMeta/> (or <graph-meta/>), :keyword[] and
  // :graph-meta{} is drawn, except inside blocks the editor keeps as source
  // (accordion groups, callouts with a formatted title).
  // One test per note, each well inside the default timeout; the last one
  // checks the total (tests in a file run in order).
  describe('in the real notes', () => {
    const count = (text: string) => (text.match(/<Keyword |<Tag |:keyword\[|:tag\[|<GraphMeta |<graph-meta |:graph-meta\{/g) ?? []).length;
    let total = 0;

    it.each(notes)('draws every graph object in $path', ({ source }) => {
      const state = editorState(source);
      const kept = nodesOf(state, 'verbatim').reduce((sum, { node }) => sum + count(String(node.attrs.value)), 0);
      const expected = count(source) - kept;
      const found = decorations(state).filter((item) => item.widget !== undefined || item.class?.startsWith('studio-keyword') === true);
      expect(found.length).toBe(expected);
      total += expected;
    });

    it('finds the graph objects', () => {
      expect(total).toBeGreaterThan(100);
    });
  });
});
