import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { assetCompletion, assetContext } from '#features/editor/asset-completion.ts';

const ASSETS = [
  'public/docs/data-modeling/data_warehouse_architecture.webp',
  'public/docs/data-platform/processing/apache-spark/mapreduce-execution-skeleton.html',
  'public/docs/data-platform/processing/apache-spark/narrow-vs-wide-transformations.svg',
  'public/docs/data-platform/stacks-integration/superset-trino-impersonate.jpg',
  'public/docs/demo/model.glb',
  'public/docs/data-platform/processing/Diagram.SVG',
  'public/docs/data-platform/processing/apache-spark/spark-programming-model/plan.png',
];
const NOTE = 'content/docs/data-platform/processing/apache-spark/index.mdx';

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
    expect(assetContext('<img alt="x" src="/docs/da')).toEqual({ from: 18, kind: 'image' });
    expect(assetContext("<img src='/no")).toEqual({ from: 10, kind: 'image' });
    expect(assetContext('<Video\n  src="')).toEqual({ from: 14, kind: 'any' });
    // A Diagram's src is a path under diagrams/, not an asset.
    expect(assetContext('<Diagram src="data-pla')).toBeNull();
    expect(assetContext('<img alt="" src="')).toEqual({ from: 17, kind: 'image' });
    expect(assetContext('<Model src="')).toEqual({ from: 12, kind: 'any' });
    expect(assetContext('See ![Bus matrix](/docs/')).toEqual({ from: 18, kind: 'image' });
  });

  it('stays out of anything else', () => {
    expect(assetContext('<img src="/docs/a.svg" ')).toBeNull();
    expect(assetContext('<img alt="')).toBeNull();
    expect(assetContext('A [link](/docs/')).toBeNull();
    expect(assetContext('srcset="')).toBeNull();
    expect(assetContext('src="')).toEqual({ from: 5, kind: 'any' });
  });
});

describe('assetCompletion', () => {
  it('offers site paths of the kind the element shows, this page first', () => {
    const images = [
      '/docs/data-modeling/data_warehouse_architecture.webp',
      '/docs/data-platform/processing/apache-spark/narrow-vs-wide-transformations.svg',
      '/docs/data-platform/stacks-integration/superset-trino-impersonate.jpg',
      // Extensions in any case, as the file API takes them.
      '/docs/data-platform/processing/Diagram.SVG',
      '/docs/data-platform/processing/apache-spark/spark-programming-model/plan.png',
    ];
    const result = complete('<img src="|" />');
    expect(result?.from).toBe(10);
    expect(result?.labels).toEqual(images);
    expect(complete('![x](|')?.labels).toEqual(images);
    const any = complete('<Model src="|');
    expect(any?.labels).toHaveLength(ASSETS.length);
    const here = any?.options.filter((option) => option.detail === 'this page').map((option) => option.label);
    expect(here).toEqual([
      '/docs/data-platform/processing/apache-spark/mapreduce-execution-skeleton.html',
      '/docs/data-platform/processing/apache-spark/narrow-vs-wide-transformations.svg',
    ]);
    expect(any?.options.find((option) => option.detail === 'this page')?.boost).toBe(2);
  });

  // Many notes keep their assets in the folder they sit in, not in a folder
  // named after the page (where uploads go).
  it('ranks the page folder, then the note\'s own folder', () => {
    const options = complete('<Model src="|', false, 'content/docs/data-platform/processing/apache-spark/spark-programming-model.mdx')?.options ?? [];
    const ranked = (detail: string) => options.filter((option) => option.detail === detail).map((option) => [option.label, option.boost]);
    expect(ranked('this page')).toEqual([['/docs/data-platform/processing/apache-spark/spark-programming-model/plan.png', 2]]);
    expect(ranked('this folder')).toEqual([
      ['/docs/data-platform/processing/apache-spark/mapreduce-execution-skeleton.html', 1],
      ['/docs/data-platform/processing/apache-spark/narrow-vs-wide-transformations.svg', 1],
    ]);
  });

  it('keeps what was typed for the editor to filter on', () => {
    expect(complete('<img src="/docs/data|')?.from).toBe(10);
  });

  it('offers nothing outside a src value', () => {
    expect(complete('Plain text |')).toBeNull();
    expect(complete('Plain text |', true)).toBeNull();
  });
});
