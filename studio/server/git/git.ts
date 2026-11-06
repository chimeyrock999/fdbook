import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { HttpError } from '../http.ts';

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 16 * 1024 * 1024;

// Runs git in the worktree without a shell, so nothing in a path or a
// message is ever parsed by one. Pathspecs are literal (no globs or magic),
// reads take no optional locks (a status refresh never makes a git command
// in a terminal fail on index.lock), git never prompts, and its messages
// stay in English for the UI. A failure throws its stderr as a 500.
// `env` adds to git's environment (a scratch GIT_INDEX_FILE).
export function runGit(root: string, args: string[], env: Record<string, string> = {}) {
  return runGitBytes(root, args, MAX_OUTPUT, env).then((stdout) => stdout.toString('utf8'));
}

// runGit for output that may not be text: a file as a commit holds it.
// `maxOutput` raises the cap for a file as large as an asset may be.
export function runGitBytes(root: string, args: string[], maxOutput = MAX_OUTPUT, env: Record<string, string> = {}) {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      'git',
      ['--literal-pathspecs', '--no-optional-locks', '-c', 'core.quotePath=false', ...args],
      { cwd: root, timeout: TIMEOUT_MS, maxBuffer: maxOutput, encoding: 'buffer', env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
      (error, stdout, stderr) => {
        // git says some refusals ("nothing to commit") on stdout.
        if (error) reject(new HttpError(500, `git ${args[0] ?? ''} failed: ${(stderr.toString('utf8').trim() || stdout.toString('utf8').trim() || error.message).trim()}`));
        else resolve(stdout);
      },
    );
  });
}

const tops = new Set<string>();

// The worktree must be the top of a git worktree: git reports paths from
// there, and the path policy reads them from the Studio's root. A root that
// passed once is not asked again.
export async function assertWorktreeTop(root: string) {
  if (tops.has(root)) return;
  const top = await runGit(root, ['rev-parse', '--show-toplevel']).catch(() => null);
  if (top === null || (await realpath(top.trim())) !== (await realpath(root))) {
    throw new HttpError(409, `${root} is not the top of a git worktree`);
  }
  tops.add(root);
}
