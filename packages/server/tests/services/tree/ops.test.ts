import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTree } from '#services/tree/build.ts';
import { applyPlan, planRename } from '#services/tree/ops.ts';
import { makeWorktree, type Worktree } from '@fdbook/testing/studio.ts';
import { writeTreeCases } from '#tests/support/tree-cases.ts';

describe('applying a rename', () => {
  let worktree: Worktree;
  const notes = (path: string) => join(worktree.root, 'content/docs', path);

  // The docs, plus the cases they do not have (support/tree-cases.ts).
  beforeEach(async () => {
    worktree = await makeWorktree();
    await writeTreeCases(worktree.root);
  });
  afterEach(async () => {
    await worktree.remove();
  });

  it('writes nothing when the page is gone by the time it moves', async () => {
    const plan = await planRename(worktree.root, await loadTree(worktree.root), { path: 'archive/old/setup-v1.mdx', slug: 'first-setup' });
    expect(plan.writes.map((write) => write.path)).toEqual(['archive/index.mdx', 'archive/meta.yaml']);
    const index = await readFile(notes('archive/index.mdx'), 'utf8');
    await rm(notes('archive/old/setup-v1.mdx'));
    await expect(applyPlan(worktree.root, plan)).rejects.toThrow('is gone');
    expect(await readFile(notes('archive/index.mdx'), 'utf8')).toBe(index);
  });

  it('writes nothing when a file changed after planning', async () => {
    const plan = await planRename(worktree.root, await loadTree(worktree.root), { path: 'diagrams', slug: 'drawings' });
    await writeFile(notes('meta.yaml'), 'pages: []\n');
    await expect(applyPlan(worktree.root, plan)).rejects.toThrow('changed on disk');
    expect((await stat(notes('diagrams'))).isDirectory()).toBe(true);
  });

  it("says that the page's images stay where they are", async () => {
    const images = join(worktree.root, 'public/docs/archive/old/setup-v1');
    await mkdir(images, { recursive: true });
    await writeFile(join(images, 'a.png'), Buffer.from([0x89, 0x50]));
    await writeFile(join(images, 'b.svg'), '<svg/>');
    const plan = await planRename(worktree.root, await loadTree(worktree.root), { path: 'archive/old/setup-v1.mdx', slug: 'first-setup' });
    expect(plan.changes.at(-1)).toEqual({ type: 'keep', path: 'public/docs/archive/old/setup-v1/', detail: '2 files stay' });
    await applyPlan(worktree.root, plan);
    expect((await stat(join(images, 'a.png'))).isFile()).toBe(true);
  });

  it('writes a file inside the renamed folder at its new place', async () => {
    // diagrams/index.mdx links to itself by its folder URL.
    await writeFile(notes('diagrams/index.mdx'), `${await readFile(notes('diagrams/index.mdx'), 'utf8')}\n[self](/docs/diagrams)\n`);
    const plan = await planRename(worktree.root, await loadTree(worktree.root), { path: 'diagrams', slug: 'drawings' });
    await applyPlan(worktree.root, plan);
    expect(await readFile(notes('drawings/index.mdx'), 'utf8')).toContain('[self](/docs/drawings)');
    await expect(stat(notes('diagrams'))).rejects.toThrow();
  });
});
