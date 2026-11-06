import { describe, expect, it } from 'vitest';
import type { ChangedFile } from '../../../src/api/changes';
import type { TreeFolder, TreeMissing } from '../../../src/api/tree';
import { folderMarked, missingStatus, treeMarks } from '../../../src/changes/marks';

const files: ChangedFile[] = [
  { path: 'content/notes/guide/one.mdx', status: 'M' },
  { path: 'content/notes/guide/deep/new.mdx', status: 'A' },
  { path: 'content/notes/guide/gone.mdx', status: 'D' },
  { path: 'content/notes/other/meta.yaml', status: 'M' },
  { path: 'content/notes/index.mdx', status: 'M' },
  { path: 'content/notes/guide/moved.mdx', status: 'R', from: 'content/notes/guide/old.mdx' },
  { path: 'public/notes/guide/pic.png', status: 'A' },
];

const folder = (path: string, meta: string | null = `${path}/meta.yaml`) =>
  ({ kind: 'folder', id: `folder:${path}`, path, title: path, meta, metaMtime: null, index: null, defaultOpen: false, icon: null, hidden: null, entry: null, children: [] }) satisfies TreeFolder;
const missing = (value: string, meta: string): TreeMissing => ({ kind: 'missing', id: '', entry: 0, value, meta });

describe('treeMarks', () => {
  const marks = treeMarks(files);

  it('marks notes by their path in content/notes; assets are not in the tree', () => {
    expect(Object.fromEntries(marks.notes)).toEqual({
      'guide/one.mdx': 'M',
      'guide/deep/new.mdx': 'A',
      'guide/gone.mdx': 'D',
      'index.mdx': 'M',
      'guide/moved.mdx': 'R',
      'guide/old.mdx': 'D',
    });
  });

  it('marks a closed folder with changes inside, and a folder whose meta.yaml changed even when open', () => {
    expect(folderMarked(marks, folder('guide'), false)).toBe(true);
    expect(folderMarked(marks, folder('guide/deep'), false)).toBe(true);
    expect(folderMarked(marks, folder('guide'), true)).toBe(false);
    expect(folderMarked(marks, folder('other'), true)).toBe(true);
    expect(folderMarked(marks, folder('gu'), false)).toBe(false);
    expect(folderMarked(marks, folder('database'), false)).toBe(false);
  });

  it('marks a meta.yaml entry whose page was deleted', () => {
    expect(missingStatus(marks, missing('gone', 'guide/meta.yaml'))).toBe('D');
    expect(missingStatus(marks, missing('old', 'guide/meta.yaml'))).toBe('D');
    expect(missingStatus(marks, missing('nothing', 'guide/meta.yaml'))).toBeNull();
    expect(missingStatus(treeMarks([{ path: 'content/notes/top/index.mdx', status: 'D' }]), missing('top', 'meta.yaml'))).toBe('D');
  });
});
