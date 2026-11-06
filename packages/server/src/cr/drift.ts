import { CommandError, git } from '#git/command.ts';

// How far a change request is from main (#21): the commits main has that the
// branch does not, and the files a merge of main into it would conflict in.
// Only commits count, not what is left uncommitted in the worktree.
export type Drift = { behind: number; conflicts: string[] };

// Reads it in `repo` with `git merge-tree`, which merges in memory: no
// worktree or index is touched. Paths are NUL separated, so a name with
// non-ASCII characters is not quoted.
export async function driftOf(repo: string, branch: string, base: string): Promise<Drift> {
  const behind = Number((await git(repo, 'rev-list', '--count', `${branch}..${base}`)).trim());
  if (behind === 0) return { behind, conflicts: [] };
  try {
    await git(repo, 'merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', branch, base);
    return { behind, conflicts: [] };
  } catch (error) {
    // Exit 1: conflicts, listed after the tree's id.
    if (!(error instanceof CommandError && error.code === 1)) throw error;
    return { behind, conflicts: [...new Set(error.stdout.split('\0').filter((path) => path !== '').slice(1))] };
  }
}
