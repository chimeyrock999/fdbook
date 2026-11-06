import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStudioServer } from '../../server/studio-server';
import { makeGitWorktree } from './git';
import { docsRoot } from './notes';

// A throwaway worktree: a copy of FdBook's docs pages (docs/content/docs)
// plus a few assets and one real diagram.
export const DEMO_DIAGRAM = 'diagrams/demo/flow.diagram.json';

export async function makeWorktree() {
  const root = await mkdtemp(join(tmpdir(), 'notes-studio-'));
  await cp(join(docsRoot, 'content/docs'), join(root, 'content/docs'), { recursive: true });
  await mkdir(join(root, 'public/docs/demo'), { recursive: true });
  await writeFile(join(root, 'public/docs/demo/pixel.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await mkdir(join(root, 'diagrams/demo'), { recursive: true });
  await cp(join(docsRoot, 'diagrams/examples/program-to-tasks.diagram.json'), join(root, DEMO_DIAGRAM));
  await writeFile(join(root, 'package.json'), '{}\n');
  return { root, remove: () => rm(root, { recursive: true, force: true }) };
}

export type Worktree = Awaited<ReturnType<typeof makeWorktree>>;

// A Studio on a free port over a throwaway worktree; with `git`, one that is
// a repository on a change request branch (support/git.ts).
export async function startTestStudio({ git = false } = {}) {
  const worktree = git ? await makeGitWorktree() : await makeWorktree();
  const studio = await startStudioServer({ port: 0, root: worktree.root });
  const port = String((studio.server.address() as AddressInfo).port);
  return {
    ...studio,
    root: worktree.root,
    port,
    origin: `http://127.0.0.1:${port}`,
    fileUrl: (path: string) => `${studio.url}api/file?path=${encodeURIComponent(path)}`,
    close: async () => {
      await studio.close();
      await worktree.remove();
    },
  };
}

export type TestStudio = Awaited<ReturnType<typeof startTestStudio>>;
