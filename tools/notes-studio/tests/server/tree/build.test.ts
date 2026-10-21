import type * as PageTree from 'fumadocs-core/page-tree';
import { loader } from 'fumadocs-core/source';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../../server/config';
import { buildTree, readNotesContent, type NotesContent } from '../../../server/tree/build';
import type { TreeFolder, TreeNode } from '../../../server/tree/types';

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

describe('page tree on content/notes', () => {
  it('lists what the site lists, in the same order', async () => {
    const notes = await readNotesContent(repoRoot);
    const tree = buildTree(notes);
    // The site's own build: the loader over the same files (lib/source.ts).
    const files = [
      ...[...notes.pages].map(([path, data]) => ({ type: 'page' as const, path, data })),
      ...[...notes.metas].map(([path, data]) => ({ type: 'meta' as const, path, data })),
    ];
    const site = loader({ baseUrl: '/notes', source: { files } }).getPageTree();
    expect(outline(tree.children, 0, (node) => !('hidden' in node) || node.hidden !== 'unlisted')).toEqual(siteOutline(site.children));
  });

  it('marks what the site leaves out of the sidebar, in place', async () => {
    const tree = buildTree(await readNotesContent(repoRoot));
    const hidden = (path: string) => {
      const node = find(tree, path);
      return node && 'hidden' in node ? node.hidden : 'not found';
    };
    // No meta.yaml lists them.
    expect(hidden('index.mdx')).toBe('unlisted');
    expect(hidden('data-platform/processing')).toBe('unlisted');
    expect(hidden('data-platform/stacks-integration/databricks/spark-foundation.mdx')).toBe('unlisted');
    expect(hidden('computer-systems')).toBe('unlisted');
    // `visible: false`, which lib/visible-page-tree.ts filters out.
    expect(hidden('data-platform/stacks-integration/databricks/databricks-interactive-runtime/driver-container-first-look.mdx')).toBe('visible-false');
    expect(hidden('distributed-systems/rpc-and-threads.mdx')).toBeNull();
    // An unlisted page stays in its own folder, after the listed ones.
    const databricks = find(tree, 'data-platform/stacks-integration/databricks');
    expect(databricks?.kind === 'folder' && databricks.children.map((child) => child.entry)).toEqual([0, ...Array<null>(10).fill(null)]);
    // Nothing in the repo points at a missing page.
    expect(outline(tree.children).filter((line) => line.trim().startsWith('missing'))).toEqual([]);
  });

  it('numbers entries so the UI knows what it can move', async () => {
    const tree = buildTree(await readNotesContent(repoRoot));
    const computer = find(tree, 'computer-systems');
    // computer-systems/meta.yaml lists its index and nested pages (`operating-systems/page-cache`).
    expect(computer?.kind === 'folder' && computer.children.map((child) => [child.entry, child.kind === 'page' ? child.path : ''])).toEqual([
      [0, 'computer-systems/index.mdx'],
      [1, 'computer-systems/operating-systems/page-cache.mdx'],
      [2, 'computer-systems/storage/wal-and-fsync.mdx'],
      [3, 'computer-systems/networking/tcp-flow-control-and-kafka-poll.mdx'],
    ]);
    // A folder without meta.yaml: its children in the order the site shows.
    const modeling = find(tree, 'data-modeling');
    expect(modeling?.kind === 'folder' && [modeling.meta, modeling.children.map((child) => child.entry)]).toEqual([null, [0]]);
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
    expect([guide.meta, guide.index, guide.defaultOpen]).toEqual(['guide/meta.yaml', 'guide/index.mdx', false]);
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
