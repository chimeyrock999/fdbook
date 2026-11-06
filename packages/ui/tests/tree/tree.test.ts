import { describe, expect, it } from 'vitest';
import type { TreeFolder, TreeNode } from '#api/tree.ts';
import { dropIndex, filterTree, renamedPath, stepIndex, trailTo } from '#tree/tree.ts';

const page = (path: string, title: string, entry: number | null, hidden: 'unlisted' | null = null): TreeNode => ({
  kind: 'page', id: `page:${path}`, path, title, icon: null, entry, hidden,
});

const guide: TreeFolder = {
  kind: 'folder', id: 'folder:guide', path: 'guide', title: 'Guide', meta: 'guide/meta.yaml', metaMtime: 1, index: 'guide/index.mdx', defaultOpen: true, icon: null,
  hidden: null, entry: 1,
  children: [page('guide/one.mdx', 'One', 0), { kind: 'missing', id: 'm', entry: 1, value: 'gone', meta: 'guide/meta.yaml' }, page('guide/two.mdx', 'Two', 2), page('guide/loose.mdx', 'Loose', null, 'unlisted')],
};
const root: TreeFolder = {
  kind: 'folder', id: 'folder:', path: '', title: 'Notes', meta: 'meta.yaml', metaMtime: 1, index: null, defaultOpen: true, icon: null, hidden: null, entry: null,
  children: [page('a.mdx', 'Alpha', 0), guide, { kind: 'separator', id: 's', entry: 2, title: 'More' }],
};

describe('tree helpers', () => {
  it('finds the folders on the way to a note', () => {
    expect(trailTo(root, 'guide/two.mdx').map((node) => node.id)).toEqual(['folder:guide', 'page:guide/two.mdx']);
    expect(trailTo(root, 'guide/index.mdx').map((node) => node.id)).toEqual(['folder:guide']);
    expect(trailTo(root, 'nowhere.mdx')).toEqual([]);
  });

  it('filters by title or path and keeps the folders on the way', () => {
    const shown = filterTree(root, 'TWO');
    expect(shown.children.map((node) => node.id)).toEqual(['folder:guide']);
    expect((shown.children[0] as TreeFolder).children.map((node) => node.id)).toEqual(['page:guide/two.mdx']);
    expect(filterTree(root, 'guide').children.map((node) => node.id)).toEqual(['folder:guide']);
    expect((filterTree(root, 'guide').children[0] as TreeFolder).children).toHaveLength(4);
    expect(filterTree(root, ' ')).toBe(root);
  });

  it('works out the entry a drop or a step moves to', () => {
    const [one, missing, two, loose] = guide.children as [TreeNode, TreeNode, TreeNode, TreeNode];
    expect(dropIndex(two, one, 'before')).toBe(0);
    expect(dropIndex(one, two, 'after')).toBe(2);
    expect(dropIndex(one, missing, 'before')).toBeNull();
    expect(dropIndex(one, loose, 'before')).toBeNull();
    expect(stepIndex(guide, two, -1)).toBe(1);
    expect(stepIndex(guide, one, -1)).toBeNull();
    expect(stepIndex(guide, two, 1)).toBeNull();
    expect(stepIndex(guide, loose, -1)).toBeNull();
  });

  it('follows a renamed page or folder', () => {
    expect(renamedPath('guide/two.mdx', 'guide/two.mdx', 'guide/2.mdx')).toBe('guide/2.mdx');
    expect(renamedPath('guide/two.mdx', 'guide', 'manual')).toBe('manual/two.mdx');
    expect(renamedPath('guidebook/x.mdx', 'guide', 'manual')).toBeNull();
    // A page rename does not move a folder of the same name.
    expect(renamedPath('guide/intro/x.mdx', 'guide/intro.mdx', 'guide/start.mdx')).toBeNull();
  });
});
