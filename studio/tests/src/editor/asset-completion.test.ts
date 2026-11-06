import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { assetCompletion, assetContext } from '../../../src/editor/asset-completion';

const ASSETS = [
  'public/notes/data-modeling/data_warehouse_architecture.webp',
  'public/notes/data-platform/processing/apache-spark/mapreduce-execution-skeleton.html',
  'public/notes/data-platform/processing/apache-spark/narrow-vs-wide-transformations.svg',
  'public/notes/data-platform/stacks-integration/superset-trino-impersonate.jpg',
  'public/notes/demo/model.glb',
  'public/notes/data-platform/processing/Diagram.SVG',
  'public/notes/data-platform/processing/apache-spark/spark-programming-model/plan.png',
];
const NOTE = 'content/notes/data-platform/processing/apache-spark/index.mdx';

// The completions at the `|` in `text`.
function complete(text: string, explicit = false, note = NOTE) {
  const pos = text.indexOf('|');
  const doc = text.replace('|', '');
  const state = EditorState.create({ doc, selection: { anchor: pos } });
  const result = assetCompletion(ASSETS, note)(new CompletionContext(state, pos, explicit)) as CompletionResult | null;
  return result && { from: result.from, labels: result.options.map((option) => option.label), options: result.options };
}

describe('assetContext', () => {
  it('finds the src value being typed and the element that owns it', () => {
    expect(assetContext('<SvgDiagram label="x" src="/notes/da')).toEqual({ from: 27, kind: 'svg' });
    expect(assetContext('<HtmlEmbed\n  src="')).toEqual({ from: 18, kind: 'html' });
    expect(assetContext("::html{src='/no")).toEqual({ from: 12, kind: 'html' });
    // A Diagram's src is a path under diagrams/, not an asset.
    expect(assetContext('<Diagram src="data-pla')).toBeNull();
    expect(assetContext('::diagram{src="')).toEqual({ from: 15, kind: 'svg' });
    expect(assetContext('<img alt="" src="')).toEqual({ from: 17, kind: 'image' });
    expect(assetContext('<Model src="')).toEqual({ from: 12, kind: 'any' });
    expect(assetContext('See ![Bus matrix](/notes/')).toEqual({ from: 18, kind: 'image' });
  });

  it('stays out of anything else', () => {
    expect(assetContext('<SvgDiagram src="/notes/a.svg" ')).toBeNull();
    expect(assetContext('<SvgDiagram label="')).toBeNull();
    expect(assetContext('A [link](/notes/')).toBeNull();
    expect(assetContext('srcset="')).toBeNull();
    expect(assetContext('src="')).toEqual({ from: 5, kind: 'any' });
  });
});

describe('assetCompletion', () => {
  it('offers site paths of the kind the element shows, this page first', () => {
    const result = complete('<SvgDiagram src="|" />');
    expect(result?.from).toBe(17);
    // Extensions in any case, as the file API takes them.
    expect(result?.labels).toEqual([
      '/notes/data-platform/processing/apache-spark/narrow-vs-wide-transformations.svg',
      '/notes/data-platform/processing/Diagram.SVG',
    ]);
    expect(complete('<HtmlEmbed src="|')?.labels).toEqual([
      '/notes/data-platform/processing/apache-spark/mapreduce-execution-skeleton.html',
    ]);
    expect(complete('![x](|')?.labels).toEqual([
      '/notes/data-modeling/data_warehouse_architecture.webp',
      '/notes/data-platform/processing/apache-spark/narrow-vs-wide-transformations.svg',
      '/notes/data-platform/stacks-integration/superset-trino-impersonate.jpg',
      '/notes/data-platform/processing/Diagram.SVG',
      '/notes/data-platform/processing/apache-spark/spark-programming-model/plan.png',
    ]);
    const any = complete('<Model src="|');
    expect(any?.labels).toHaveLength(ASSETS.length);
    const here = any?.options.filter((option) => option.detail === 'this page').map((option) => option.label);
    expect(here).toEqual([
      '/notes/data-platform/processing/apache-spark/mapreduce-execution-skeleton.html',
      '/notes/data-platform/processing/apache-spark/narrow-vs-wide-transformations.svg',
    ]);
    expect(any?.options.find((option) => option.detail === 'this page')?.boost).toBe(2);
  });

  // Many notes keep their assets in the folder they sit in, not in a folder
  // named after the page (where uploads go).
  it('ranks the page folder, then the note\'s own folder', () => {
    const options = complete('<Model src="|', false, 'content/notes/data-platform/processing/apache-spark/spark-programming-model.mdx')?.options ?? [];
    const ranked = (detail: string) => options.filter((option) => option.detail === detail).map((option) => [option.label, option.boost]);
    expect(ranked('this page')).toEqual([['/notes/data-platform/processing/apache-spark/spark-programming-model/plan.png', 2]]);
    expect(ranked('this folder')).toEqual([
      ['/notes/data-platform/processing/apache-spark/mapreduce-execution-skeleton.html', 1],
      ['/notes/data-platform/processing/apache-spark/narrow-vs-wide-transformations.svg', 1],
    ]);
  });

  it('keeps what was typed for the editor to filter on', () => {
    expect(complete('<SvgDiagram src="/notes/data|')?.from).toBe(17);
  });

  it('offers nothing outside a src value', () => {
    expect(complete('Plain text |')).toBeNull();
    expect(complete('Plain text |', true)).toBeNull();
  });
});
