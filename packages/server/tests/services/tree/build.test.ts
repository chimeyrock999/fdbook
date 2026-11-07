import type * as PageTree from 'fumadocs-core/page-tree';
import { loader } from 'fumadocs-core/source';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { docsRoot } from '@fdbook/testing/notes.ts';
import { makeWorktree, type Worktree } from '@fdbook/testing/studio.ts';
import { writeTreeCases } from '#tests/support/tree-cases.ts';
import { buildTree, loadTree, readNotesContent, type NotesContent } from '#services/tree/build.ts';
import type { TreeFolder, TreeNode } from '@fdbook/shared/tree.ts';

// One line per node, indented by depth: what the tests compare.
function outline(nodes: TreeNode[], depth = 0, keep: (node: TreeNode) => boolean = () => true): string[] {
  return nodes.filter(keep).flatMap((node) => {
    const line = `${'  '.repeat(depth)}${node.kind} ${node.kind === 'missing' ? node.value : node.title}`;
    return node.kind === 'folder' ? [line, ...outline(node.children, depth + 1, keep)] : [line];
  });
}

function siteOutline(nodes: PageTree.Node[], depth = 0): string[] {
  return nodes.flatMap((node) => {
    const kind = node.type === 'page' && node.$ref === undefined ? 'link' : node.type;
    const line = `${'  '.repeat(depth)}${kind} ${typeof node.name === 'string' ? node.name : ''}`;
    return node.type === 'folder' ? [line, ...siteOutline(node.children, depth + 1)] : [line];
  });
}

const find = (folder: TreeFolder, path: string): TreeNode | undefined => {
  for (const child of folder.children) {
    if ((child.kind === 'page' || child.kind === 'folder') && child.path === path) return child;
    if (child.kind === 'folder') {
      const found = find(child, path);
      if (found) return found;
    }
  }
  return undefined;
};

function content(pages: Record<string, Record<string, unknown>>, metas: Record<string, Record<string, unknown>>): NotesContent {
  return { pages: new Map(Object.entries(pages)), metas: new Map(Object.entries(metas)) };
}

describe('page tree on content/docs', () => {
  // The docs, plus the cases they do not have (support/tree-cases.ts).
  let worktree: Worktree;

  beforeAll(async () => {
    worktree = await makeWorktree();
    await writeTreeCases(worktree.root);
  });
  afterAll(async () => {
    await worktree.remove();
  });

  it('carries the icons the site shows, a folder falling back to its index page', async () => {
    const icons: Record<string, string> = {};
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if ((node.kind === 'page' || node.kind === 'folder') && node.icon !== null) icons[node.path] = node.icon;
        if (node.kind === 'folder') walk(node.children);
      }
    };
    // loadTree: with the site's icon names, as the Studio serves it.
    walk((await loadTree(worktree.root)).children);
    expect(icons).toEqual({
      'index.mdx': 'BookOpen',
      'archive': 'Archive',
      // Listed as a page: this index page is a row of its own.
      'archive/index.mdx': 'Shrub',
      // No meta.yaml: the index page's.
      'patterns': 'Sprout',
    });
  });

  it('lists what the site lists, in the same order', async () => {
    for (const root of [docsRoot, worktree.root]) {
      const notes = await readNotesContent(root);
      const tree = buildTree(notes);
      // The site's own build: the loader over the same files (lib/source.ts).
      const files = [
        ...[...notes.pages].map(([path, data]) => ({ type: 'page' as const, path, data })),
        ...[...notes.metas].map(([path, data]) => ({ type: 'meta' as const, path, data })),
      ];
      const site = loader({ baseUrl: '/docs', source: { files } }).getPageTree();
      expect(outline(tree.children, 0, (node) => !('hidden' in node) || node.hidden !== 'unlisted')).toEqual(siteOutline(site.children));
    }
  });

  it('marks what the site leaves out of the sidebar, in place', async () => {
    const tree = buildTree(await readNotesContent(worktree.root));
    const hidden = (path: string) => {
      const node = find(tree, path);
      return node && 'hidden' in node ? node.hidden : 'not found';
    };
    // No meta.yaml lists them.
    expect(hidden('archive')).toBe('unlisted');
    expect(hidden('guide/drafts.mdx')).toBe('unlisted');
    // `visible: false`, which lib/visible-page-tree.ts filters out.
    expect(hidden('archive/old/retired.mdx')).toBe('visible-false');
    expect(hidden('reference/lint.mdx')).toBeNull();
    // An unlisted page stays in its own folder, after the listed ones.
    const guide = find(tree, 'guide');
    expect(guide?.kind === 'folder' && guide.children.map((child) => child.entry)).toEqual([0, 1, 2, null]);
    // Nothing in the docs points at a missing page.
    expect(outline(buildTree(await readNotesContent(docsRoot)).children).filter((line) => line.trim().startsWith('missing'))).toEqual([]);
  });

  it('numbers entries so the UI knows what it can move', async () => {
    const tree = buildTree(await readNotesContent(worktree.root));
    const archive = find(tree, 'archive');
    // archive/meta.yaml lists its index and nested pages (`old/setup-v1`).
    expect(archive?.kind === 'folder' && archive.children.map((child) => [child.entry, child.kind === 'page' ? child.path : ''])).toEqual([
      [0, 'archive/index.mdx'],
      [1, 'archive/old/setup-v1.mdx'],
      [2, 'archive/old/retired.mdx'],
    ]);
    // A folder without meta.yaml: its children in the order the site shows.
    const patterns = find(tree, 'patterns');
    expect(patterns?.kind === 'folder' && [patterns.meta, patterns.children.map((child) => child.entry)]).toEqual([null, [0]]);
  });
});

describe('page tree syntax', () => {
  const notes = content(
    {
      'index.mdx': { title: 'Home' },
      'a.mdx': { title: 'A' },
      'b.mdx': { title: 'B' },
      'c.mdx': { title: 'C', visible: false },
      'hidden.mdx': { title: 'Hidden' },
      'guide/index.mdx': { title: 'Guide' },
      'guide/one.mdx': { title: 'One' },
      'guide/two.mdx': { title: 'Two' },
      'deep/x/y.mdx': { title: 'Y' },
      'pack/p.mdx': { title: 'P' },
      'pack/q.mdx': { title: 'Q' },
    },
    {
      'meta.yaml': {
        title: 'Root',
        pages: ['index', '---[Rocket]Start---', 'b', '[Site](https://example.com)', 'gone', '...pack', '!hidden', 'deep/x/y', '...', '!nope'],
      },
      'guide/meta.yaml': { title: 'The Guide', defaultOpen: false, pages: ['two', 'z...a'] },
    },
  );

  it('takes a folder icon from meta.yaml before its index page', () => {
    const tree = buildTree(content(
      { 'a/index.mdx': { title: 'A', icon: 'Sprout' }, 'b/index.mdx': { title: 'B', icon: 'Sprout' }, 'c/x.mdx': { title: 'X', icon: 'Leaf' }, 'd.mdx': { title: 'D' } },
      { 'b/meta.yaml': { title: 'B', icon: 'TreePine' } },
    ));
    expect(['a', 'b', 'c', 'c/x.mdx', 'd.mdx'].map((path) => (find(tree, path) as { icon: string | null }).icon)).toEqual(['Sprout', 'TreePine', null, 'Leaf', null]);
  });

  it('drops an icon name the site does not have', () => {
    const tree = buildTree(content({ 'a.mdx': { title: 'A', icon: 'Sprout' }, 'b.mdx': { title: 'B', icon: 'NotALucideIcon' } }, {}), new Set(['Sprout']));
    expect(['a.mdx', 'b.mdx'].map((path) => (find(tree, path) as { icon: string | null }).icon)).toEqual(['Sprout', null]);
  });

  it('follows separators, links, rest, extract, exclude and nested entries', () => {
    const tree = buildTree(notes);
    expect(outline(tree.children, 0, (node) => !('hidden' in node) || node.hidden !== 'unlisted')).toEqual([
      'page Home',
      'separator Start',
      'page B',
      'link Site',
      'missing gone',
      'page P',
      'page Q',
      'page Y',
      'page A',
      'page C',
      // Emptied by the nested entry, but `...` still lists the folders, as on the site.
      'folder Deep',
      '  folder X',
      'folder The Guide',
      '  page Two',
      '  page One',
      'missing !nope',
    ]);
    expect(tree.children.map((child) => child.entry)).toEqual([0, 1, 2, 3, 4, null, null, 7, null, null, null, null, 9, null]);
    expect((find(tree, 'hidden.mdx') as { hidden: string }).hidden).toBe('unlisted');
    expect((find(tree, 'c.mdx') as { hidden: string }).hidden).toBe('visible-false');
    const guide = find(tree, 'guide') as TreeFolder;
    expect([guide.meta, guide.index]).toEqual(['guide/meta.yaml', 'guide/index.mdx']);
  });

  it('gives every node a distinct id', () => {
    const ids: string[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        ids.push(node.id);
        if (node.kind === 'folder') walk(node.children);
      }
    };
    walk(buildTree(notes).children);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
