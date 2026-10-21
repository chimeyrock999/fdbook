import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTree } from '../../../server/tree/build';
import { applyPlan, planRename } from '../../../server/tree/ops';
import { makeWorktree, type Worktree } from '../../support/studio';

describe('applying a rename', () => {
  let worktree: Worktree;
  const notes = (path: string) => join(worktree.root, 'content/notes', path);

  beforeEach(async () => {
    worktree = await makeWorktree();
  });
  afterEach(async () => {
    await worktree.remove();
  });

  it('writes nothing when the page is gone by the time it moves', async () => {
    const plan = await planRename(worktree.root, await loadTree(worktree.root), { path: 'computer-systems/operating-systems/page-cache.mdx', slug: 'os-cache' });
    expect(plan.writes.map((write) => write.path)).toEqual(['computer-systems/index.mdx', 'computer-systems/meta.yaml']);
    const index = await readFile(notes('computer-systems/index.mdx'), 'utf8');
    await rm(notes('computer-systems/operating-systems/page-cache.mdx'));
    await expect(applyPlan(worktree.root, plan)).rejects.toThrow('is gone');
    expect(await readFile(notes('computer-systems/index.mdx'), 'utf8')).toBe(index);
  });

  it('writes nothing when a file changed after planning', async () => {
    const plan = await planRename(worktree.root, await loadTree(worktree.root), { path: 'distributed-systems/mapreduce', slug: 'map-reduce' });
    await writeFile(notes('distributed-systems/meta.yaml'), 'pages: []\n');
    await expect(applyPlan(worktree.root, plan)).rejects.toThrow('changed on disk');
    expect((await stat(notes('distributed-systems/mapreduce'))).isDirectory()).toBe(true);
  });

  it('writes a file inside the renamed folder at its new place', async () => {
    // mapreduce/index.mdx links to itself by its folder URL.
    await writeFile(notes('distributed-systems/mapreduce/index.mdx'), `${await readFile(notes('distributed-systems/mapreduce/index.mdx'), 'utf8')}\n[self](/notes/distributed-systems/mapreduce)\n`);
    const plan = await planRename(worktree.root, await loadTree(worktree.root), { path: 'distributed-systems/mapreduce', slug: 'map-reduce' });
    await applyPlan(worktree.root, plan);
    expect(await readFile(notes('distributed-systems/map-reduce/index.mdx'), 'utf8')).toContain('[self](/notes/distributed-systems/map-reduce)');
    await expect(stat(notes('distributed-systems/mapreduce'))).rejects.toThrow();
  });
});
