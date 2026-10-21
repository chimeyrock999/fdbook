import { describe, expect, it } from 'vitest';
import type { AssetInfo } from '../../../src/api/assets';
import { buildAssetTree, foldersTo, type AssetFolder } from '../../../src/assets/asset-tree';

const use = { note: 'content/notes/a.mdx', line: 1, column: 1, length: 1, text: '', unsure: false };
const asset = (path: string, used = 0): AssetInfo => ({ path, mtimeMs: 1, usages: Array.from({ length: used }, () => use), sources: [] });

const ASSETS = [
  asset('public/notes/guide/b.png', 1),
  asset('public/notes/guide/a.svg'),
  asset('public/notes/guide/deep/flow.html', 2),
  asset('public/notes/top.png'),
];

const outline = (folder: AssetFolder): unknown => ({
  [folder.path]: [...folder.folders.map(outline), ...folder.files.map((file) => file.path)],
});

describe('buildAssetTree', () => {
  it('nests assets by folder, folders first, each sorted', () => {
    expect(outline(buildAssetTree(ASSETS))).toEqual({
      'public/notes': [
        { 'public/notes/guide': [{ 'public/notes/guide/deep': ['public/notes/guide/deep/flow.html'] }, 'public/notes/guide/a.svg', 'public/notes/guide/b.png'] },
        'public/notes/top.png',
      ],
    });
  });

  it('filters by path and by use', () => {
    expect(outline(buildAssetTree(ASSETS, { query: 'FLOW' }))).toEqual({
      'public/notes': [{ 'public/notes/guide': [{ 'public/notes/guide/deep': ['public/notes/guide/deep/flow.html'] }] }],
    });
    expect(outline(buildAssetTree(ASSETS, { unused: true }))).toEqual({
      'public/notes': [{ 'public/notes/guide': ['public/notes/guide/a.svg'] }, 'public/notes/top.png'],
    });
  });
});

describe('foldersTo', () => {
  it('lists the folders down to the given one', () => {
    expect(foldersTo('public/notes/guide/deep')).toEqual(['public/notes/guide', 'public/notes/guide/deep']);
    expect(foldersTo('public/notes')).toEqual([]);
    expect(foldersTo('content/notes/guide')).toEqual([]);
  });
});
