import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { revertChange, watchRun } from '../../../server/agents/watch';
import { worktreeState } from '../../../server/agents/worktree';
import { git, makeGitWorktree } from '../../support/git';
import type { Worktree } from '../../support/studio';

describe('run watch', () => {
  let worktree: Worktree;
  let root: string;

  beforeAll(async () => {
    worktree = await makeGitWorktree();
    root = await realpath(worktree.root);
  });

  afterAll(async () => {
    await worktree.remove();
  });

  it('keeps no earlier version of a dirty file too large to keep, rather than HEAD\'s', async () => {
    const note = 'content/docs/large.mdx';
    await writeFile(join(root, note), 'Committed.\n');
    git(root, 'add', '--', note);
    git(root, 'commit', '--quiet', '-m', 'a small note');
    await writeFile(join(root, note), 'x'.repeat(26 * 1024 * 1024));
    const watch = watchRun(root, worktreeState(root));
    await watch.ready;
    await writeFile(join(root, note), 'Changed by the run.\n');
    expect(await watch.settle([note])).toMatchObject([{ path: note, before: null, reason: 'too large to keep its earlier version' }]);
    expect(await readFile(join(root, note), 'utf8')).toBe('Changed by the run.\n');
  });

  it('marks a file a person saved during the run, to revert by hand', async () => {
    const note = 'content/docs/saved.mdx';
    const watch = watchRun(root, worktreeState(root));
    await watch.ready;
    watch.savedByPerson(note);
    await writeFile(join(root, note), 'By a person.\n');
    expect(await watch.settle([note])).toMatchObject([{ path: note, before: null, reason: 'also saved by a person during the turn: revert it by hand' }]);
    await expect(revertChange(root, (await watch.settle([note]))[0])).rejects.toThrow('revert it by hand');
    expect(await readFile(join(root, note), 'utf8')).toBe('By a person.\n');
  });

  it('lists the files committed since the run started', async () => {
    const note = 'content/docs/committed.mdx';
    const watch = watchRun(root, worktreeState(root));
    await watch.ready;
    await writeFile(join(root, note), 'Committed by the agent.\n');
    git(root, 'add', '--', note);
    git(root, 'commit', '--quiet', '-m', 'by the agent');
    expect(await watch.committed()).toEqual([note]);
  });
});
