import { describe, expect, it } from 'vitest';
import type { AssetInfo } from '#api/assets.ts';
import { buildAssetTree, foldersTo, type AssetFolder } from '#assets/asset-tree.ts';

const use = { note: 'content/docs/a.mdx', line: 1, column: 1, length: 1, text: '', unsure: false };
const asset = (path: string, used = 0): AssetInfo => ({ path, mtimeMs: 1, size: 1, usages: Array.from({ length: used }, () => use) });

const ASSETS = [
  asset('public/docs/guide/b.png', 1),
  asset('public/docs/guide/a.svg'),
  asset('public/docs/guide/deep/flow.html', 2),
  asset('public/docs/top.png'),
];

const outline = (folder: AssetFolder): unknown => ({
  [folder.path]: [...folder.folders.map(outline), ...folder.files.map((file) => file.path)],
});

describe('buildAssetTree', () => {
  it('nests assets by folder, folders first, each sorted', () => {
    expect(outline(buildAssetTree(ASSETS))).toEqual({
      'public/docs': [
        { 'public/docs/guide': [{ 'public/docs/guide/deep': ['public/docs/guide/deep/flow.html'] }, 'public/docs/guide/a.svg', 'public/docs/guide/b.png'] },
        'public/docs/top.png',
      ],
    });
  });

  it('filters by path and by use', () => {
    expect(outline(buildAssetTree(ASSETS, { query: 'FLOW' }))).toEqual({
      'public/docs': [{ 'public/docs/guide': [{ 'public/docs/guide/deep': ['public/docs/guide/deep/flow.html'] }] }],
    });
    expect(outline(buildAssetTree(ASSETS, { unused: true }))).toEqual({
      'public/docs': [{ 'public/docs/guide': ['public/docs/guide/a.svg'] }, 'public/docs/top.png'],
    });
  });
});

describe('buildAssetTree under diagrams/', () => {
  it('builds the diagrams/ tree apart from public/docs', () => {
    const diagram = { path: 'diagrams/guide/flow.diagram.json', mtimeMs: 1, size: 1, usages: [] };
    const tree = buildAssetTree([...ASSETS, diagram], { prefix: 'diagrams/' });
    expect(tree.path).toBe('diagrams');
    expect(tree.folders.map((folder) => folder.path)).toEqual(['diagrams/guide']);
    expect(tree.folders[0].files.map((file) => file.path)).toEqual([diagram.path]);
    expect(JSON.stringify(buildAssetTree([...ASSETS, diagram]))).not.toContain('diagrams/');
    expect(foldersTo('diagrams/guide/deep')).toEqual(['diagrams/guide', 'diagrams/guide/deep']);
  });
});

describe('foldersTo', () => {
  it('lists the folders down to the given one', () => {
    expect(foldersTo('public/docs/guide/deep')).toEqual(['public/docs/guide', 'public/docs/guide/deep']);
    expect(foldersTo('public/docs')).toEqual([]);
    expect(foldersTo('content/docs/guide')).toEqual([]);
  });
});
