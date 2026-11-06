import { execFileSync } from 'node:child_process';
import { makeWorktree } from './studio';

// Runs git in `root` as a test user, whatever the machine's git config says.
export function git(root: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Studio Test',
      GIT_AUTHOR_EMAIL: 'studio@example.com',
      GIT_COMMITTER_NAME: 'Studio Test',
      GIT_COMMITTER_EMAIL: 'studio@example.com',
    },
  });
}

// A throwaway worktree that is a git repository: everything committed on
// `main`, `origin/main` pointing there, and a change request branch
// `cr/test` checked out, as #16 leaves a new change request.
export async function makeGitWorktree() {
  const worktree = await makeWorktree();
  const { root } = worktree;
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Studio Test');
  git(root, 'config', 'user.email', 'studio@example.com');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'initial');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(root, 'switch', '--quiet', '-c', 'cr/test');
  return worktree;
}
