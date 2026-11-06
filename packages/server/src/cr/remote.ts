import { CommandError, git, run } from '#git/command.ts';

export type ClosePullRequest = (number: number) => Promise<void>;

export const REMOTE = 'origin';
const TIMEOUT_MS = 120_000;

// `gh pr close`, saying where it was closed from.
export function ghClosePullRequest(repo: string): ClosePullRequest {
  return async (number) => {
    await run('gh', ['pr', 'close', String(number), '--comment', 'Discarded in Notes Studio.'], repo, { timeoutMs: TIMEOUT_MS });
  };
}

// Whether origin has the branch now: `git ls-remote --exit-code` exits 2
// when it does not, whatever language git speaks.
async function onRemote(repo: string, branch: string) {
  try {
    await run('git', ['ls-remote', '--exit-code', '--heads', REMOTE, `refs/heads/${branch}`], repo, { timeoutMs: TIMEOUT_MS });
    return true;
  } catch (error) {
    if (error instanceof CommandError && error.code === 2) return false;
    throw error;
  }
}

// Deletes the branch on origin and the clone's ref of it. A branch already
// gone there (GitHub deletes a merged pull request's head) is not an error.
export async function deleteRemoteBranch(repo: string, branch: string) {
  try {
    if (await onRemote(repo, branch)) await run('git', ['push', '--quiet', REMOTE, '--delete', branch], repo, { timeoutMs: TIMEOUT_MS });
  } catch (error) {
    throw error instanceof CommandError && error.killed ? new Error(`${REMOTE} did not answer in time.`) : error;
  }
  await git(repo, 'update-ref', '-d', `refs/remotes/${REMOTE}/${branch}`);
}
