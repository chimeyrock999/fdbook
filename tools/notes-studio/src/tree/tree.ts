import type { TreeFolder, TreeNode } from '../api/tree';

// Pure helpers for the page tree UI. Paths are relative to content/notes.

// The note a node opens: a page, or a folder's index page.
export function noteOf(node: TreeNode): string | null {
  if (node.kind === 'page') return node.path;
  if (node.kind === 'folder') return node.index;
  return null;
}

export const titleOf = (node: TreeNode) => (node.kind === 'missing' ? node.value : node.title);

// The folders from the root down to the node that opens `note`, both ends
// included; empty when no node opens it.
export function trailTo(folder: TreeFolder, note: string): TreeNode[] {
  for (const child of folder.children) {
    if (noteOf(child) === note) return [child];
    if (child.kind === 'folder') {
      const below = trailTo(child, note);
      if (below.length > 0) return [child, ...below];
    }
  }
  return [];
}

// The tree cut down to the nodes whose title or path holds `query`, with
// the folders on the way to them. A folder that matches keeps all its
// children. Separators, links and broken entries only show unfiltered.
export function filterTree(folder: TreeFolder, query: string): TreeFolder {
  const q = query.trim().toLowerCase();
  if (q === '') return folder;
  const matches = (node: TreeNode) =>
    (node.kind === 'page' || node.kind === 'folder') && (node.title.toLowerCase().includes(q) || node.path.toLowerCase().includes(q));
  const keep = (nodes: TreeNode[]): TreeNode[] =>
    nodes.flatMap((node) => {
      if (matches(node)) return [node];
      if (node.kind !== 'folder') return [];
      const children = keep(node.children);
      return children.length > 0 ? [{ ...node, children }] : [];
    });
  return { ...folder, children: keep(folder.children) };
}

// Whether a node of `folder` has its own entry there that a move can take.
export const movable = (node: TreeNode) => node.entry !== null && !('hidden' in node && node.hidden === 'unlisted');

// The entry index that puts `node` just before (`before`) or after
// `target`, both children of the same folder.
export function dropIndex(node: TreeNode, target: TreeNode, place: 'before' | 'after'): number | null {
  if (node.entry === null || target.entry === null || node === target) return null;
  const from = node.entry;
  const at = target.entry;
  const to = place === 'before' ? (from > at ? at : at - 1) : from > at ? at + 1 : at;
  return to === from ? null : to;
}

// The entry index of the movable sibling next to `node` in `direction`.
export function stepIndex(folder: TreeFolder, node: TreeNode, direction: -1 | 1): number | null {
  const siblings = folder.children.filter(movable);
  const at = siblings.indexOf(node) + direction;
  return !movable(node) || at < 0 || at >= siblings.length ? null : siblings[at].entry;
}

// The name a page or folder has in its folder: `intro` for intro.mdx.
export const slugOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.mdx$/, '');

// Same as obsidian-plugin and server/tree/template.ts.
export function normalizeSlug(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// `path` after the rename of `from` to `to` (a page `x.mdx` or a folder),
// or null when the rename does not move it.
export function renamedPath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  if (!from.endsWith('.mdx') && path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
  return null;
}
