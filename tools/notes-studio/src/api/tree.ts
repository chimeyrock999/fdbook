// Client for the page tree (server/tree/api.ts). Types mirror
// server/tree/types.ts and server/tree/ops.ts; paths are relative to
// content/notes.

export type Hidden = 'unlisted' | 'visible-false';

type Base = { id: string; entry: number | null };

export type TreeFolder = Base & {
  kind: 'folder';
  title: string;
  path: string;
  meta: string | null;
  metaMtime: number | null;
  index: string | null;
  defaultOpen: boolean;
  hidden: Hidden | null;
  children: TreeNode[];
};
export type TreePage = Base & { kind: 'page'; title: string; path: string; hidden: Hidden | null };
export type TreeSeparator = Base & { kind: 'separator'; title: string };
export type TreeLink = Base & { kind: 'link'; title: string; url: string };
export type TreeMissing = Base & { kind: 'missing'; value: string; meta: string };
export type TreeNode = TreeFolder | TreePage | TreeSeparator | TreeLink | TreeMissing;

export type TreeChange =
  | { type: 'add'; path: string }
  | { type: 'change'; path: string; detail: string }
  | { type: 'move'; path: string; to: string }
  // Left where it is: a page's images in public/notes (a worktree path).
  | { type: 'keep'; path: string; detail: string };

export type TreeRequest =
  | { op: 'create'; parent: string; slug: string; title: string; kind: 'page' | 'folder'; after: number | null }
  | { op: 'rename'; path: string; slug: string }
  | { op: 'move'; folder: string; from: number; to: number; baseMtime: number | null };

export type TreeAnswer = { changes: TreeChange[]; open: string | null };

export function createTreeClient(base = '') {
  async function failed(response: Response): Promise<never> {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${String(response.status)}`);
  }

  return {
    async loadTree(): Promise<TreeFolder> {
      const response = await fetch(`${base}/api/tree`);
      if (!response.ok) return failed(response);
      return ((await response.json()) as { tree: TreeFolder }).tree;
    },

    // Applies the change, or with `dryRun` only says what it would write.
    async change(request: TreeRequest, dryRun = false): Promise<TreeAnswer> {
      const response = await fetch(`${base}/api/tree`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, dryRun }),
      });
      if (!response.ok) return failed(response);
      return (await response.json()) as TreeAnswer;
    },
  };
}

export type TreeClient = ReturnType<typeof createTreeClient>;
