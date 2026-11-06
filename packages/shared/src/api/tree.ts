// The page tree the Studio shows, as GET /api/tree sends it. Paths are
// relative to content/notes (`guide/intro.mdx`, folders as `guide`).

// Why the site leaves a node out of its sidebar: no meta file lists it (it is
// in fumadocs' fallback tree), or it says `visible: false`.
export type Hidden = 'unlisted' | 'visible-false';

// `entry` is the node's index in its parent folder's meta file `pages` when
// the node comes from an entry of its own there, so it can be moved. In a
// folder without a meta file every child is its own entry, in the order the
// site shows them. Nodes that `...` brings in, or that another meta file
// lists, have none.
type Base = { id: string; entry: number | null };

export type TreeFolder = Base & {
  kind: 'folder';
  title: string;
  path: string;
  // The folder's meta file (meta.json or meta.yaml).
  meta: string | null;
  // The mtime the meta file was read at: a move sends it back as baseMtime.
  metaMtime: number | null;
  // A meta.yaml next to the meta.json the tree reads: the site reads one of
  // the two, which one depends on file order.
  ignoredMeta?: string;
  index: string | null;
  // The meta file's `defaultOpen`: whether the site's sidebar starts it open.
  defaultOpen: boolean;
  // The lucide icon name the site's sidebar shows (see iconOf in build.ts).
  icon: string | null;
  hidden: Hidden | null;
  children: TreeNode[];
};

export type TreePage = Base & { kind: 'page'; title: string; path: string; icon: string | null; hidden: Hidden | null };
export type TreeSeparator = Base & { kind: 'separator'; title: string };
export type TreeLink = Base & { kind: 'link'; title: string; url: string };
// An entry of `meta` that reaches no page or folder.
export type TreeMissing = Base & { kind: 'missing'; value: string; meta: string };

export type TreeNode = TreeFolder | TreePage | TreeSeparator | TreeLink | TreeMissing;

// The 409 of a delete whose files changed since its dry run: the UI reads
// the list again on it (src/features/tree/DeleteDialog.tsx). No Node imports here.
export const CHANGED_SINCE = 'the notes changed since the dry run: check the list again';
