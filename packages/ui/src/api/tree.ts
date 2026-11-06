// Client for the page tree (server/routes/tree.ts). Types mirror
// @fdbook/shared api/tree.ts and server/services/tree/ops.ts; paths are relative to
// content/notes.

import { errorOf, readJson } from './json';
import { studioFetch } from './session';
import { API_BASE } from './workspace';

export type Hidden = 'unlisted' | 'visible-false';

type Base = { id: string; entry: number | null };

export type TreeFolder = Base & {
  kind: 'folder';
  title: string;
  path: string;
  meta: string | null;
  metaMtime: number | null;
  index: string | null;
  // meta.yaml's `defaultOpen`: whether the site's sidebar starts it open.
  defaultOpen: boolean;
  // The lucide icon name the site's sidebar shows (see iconOf in build.ts).
  icon: string | null;
  hidden: Hidden | null;
  children: TreeNode[];
};
export type TreePage = Base & { kind: 'page'; title: string; path: string; icon: string | null; hidden: Hidden | null };
export type TreeSeparator = Base & { kind: 'separator'; title: string };
export type TreeLink = Base & { kind: 'link'; title: string; url: string };
export type TreeMissing = Base & { kind: 'missing'; value: string; meta: string };
export type TreeNode = TreeFolder | TreePage | TreeSeparator | TreeLink | TreeMissing;

export type TreeChange =
  | { type: 'add'; path: string }
  | { type: 'change'; path: string; detail: string }
  | { type: 'move'; path: string; to: string }
  | { type: 'delete'; path: string }
  // Left where it is: a page's images in public/notes (a worktree path).
  | { type: 'keep'; path: string; detail: string };

// A page `x.mdx`, a folder page `x/index.mdx` with `x/meta.yaml`, or a
// folder with only `x/meta.yaml`.
export type CreateKind = 'page' | 'folder-page' | 'plain-folder';

export type TreeRequest =
  | { op: 'create'; parent: string; slug: string; title: string; kind: CreateKind; defaultOpen: boolean; after: number | null }
  | { op: 'rename'; path: string; slug: string }
  | { op: 'move'; folder: string; from: number; to: number; baseMtime: number | null }
  | { op: 'set-open'; folder: string; defaultOpen: boolean; baseMtime: number | null }
  // `visible: false` in the page's frontmatter or the folder's meta.yaml, or out again.
  | { op: 'visibility'; path: string; visible: boolean }
  // A page `x.mdx`, folder page `x/index.mdx` or folder `x`; `base` from its dry run.
  | { op: 'delete'; path: string; base?: string };

// A note that still links to what a delete takes (relative to content/notes).
export type IncomingLink = { note: string; line: number; href: string };

// `created`: the page or folder a create added. A delete answers `base`
// (send it back to delete), the `links` it leaves broken, and the notes it
// takes (`deleted`).
export type TreeAnswer = { changes: TreeChange[]; open: string | null; created?: string; base?: string; links?: IncomingLink[]; deleted?: string[] };

export function createTreeClient(base = API_BASE) {
  async function failed(response: Response): Promise<never> {
    throw await errorOf(response);
  }

  return {
    async loadTree(): Promise<TreeFolder> {
      const response = await studioFetch(`${base}/api/tree`);
      if (!response.ok) return failed(response);
      return (await readJson<{ tree: TreeFolder }>(response)).tree;
    },

    // Applies the change, or with `dryRun` only says what it would write.
    async change(request: TreeRequest, dryRun = false): Promise<TreeAnswer> {
      const response = await studioFetch(`${base}/api/tree`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, dryRun }),
      });
      if (!response.ok) return failed(response);
      return readJson<TreeAnswer>(response);
    },
  };
}

export type TreeClient = ReturnType<typeof createTreeClient>;
