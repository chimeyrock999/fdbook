// The page tree the Studio shows, as GET /api/tree sends it. Paths are
// relative to content/notes (`guide/intro.mdx`, folders as `guide`).

// Why the site leaves a node out of its sidebar: no meta.yaml lists it (it is
// in fumadocs' fallback tree), or it says `visible: false`.
export type Hidden = 'unlisted' | 'visible-false';

// `entry` is the node's index in its parent folder's meta.yaml `pages` when
// the node comes from an entry of its own there, so it can be moved. In a
// folder without meta.yaml every child is its own entry, in the order the
// site shows them. Nodes that `...` brings in, or that another meta.yaml
// lists, have none.
type Base = { id: string; entry: number | null };

export type TreeFolder = Base & {
  kind: 'folder';
  title: string;
  path: string;
  meta: string | null;
  // The mtime meta.yaml was read at: a move sends it back as baseMtime.
  metaMtime: number | null;
  index: string | null;
  defaultOpen: boolean;
  hidden: Hidden | null;
  children: TreeNode[];
};

export type TreePage = Base & { kind: 'page'; title: string; path: string; hidden: Hidden | null };
export type TreeSeparator = Base & { kind: 'separator'; title: string };
export type TreeLink = Base & { kind: 'link'; title: string; url: string };
// An entry of `meta` that reaches no page or folder.
export type TreeMissing = Base & { kind: 'missing'; value: string; meta: string };

export type TreeNode = TreeFolder | TreePage | TreeSeparator | TreeLink | TreeMissing;
