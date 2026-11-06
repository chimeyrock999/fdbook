import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError } from '#infra/http.ts';
import { MAIN_BRANCH } from '@fdbook/shared/branch.ts';
import { readCommits, type Commit } from './history.ts';
import { runGit } from './git.ts';
import { loadChanges } from './status.ts';

const MAX_PATHS = 5000;

export type CommitRequest = { message: unknown; paths: unknown };

// The commit author for a GitHub user, with GitHub's no-reply address so
// the commit links to them; the committer stays the host's git identity.
export const authorOf = ({ id, login, name }: { id: number; login: string; name: string | null }) =>
  `${(name ?? '').replace(/[<>\n]/g, '').trim() || login} <${String(id)}+${login}@users.noreply.github.com>`;

// Commits the picked files, and only them, with the message. Every path must
// be one `git status` lists now (a rename brings its old path along). Files
// not picked stay as they were: `git commit -- <paths>` commits those paths
// alone, whatever else is staged, and takes them as they are on disk when it
// runs. Files on disk are added first, so new ones are known; a path gone
// from disk (a deletion, a rename's old path, staged or not) is left to the
// commit, which records it from HEAD. If the commit then fails (a hook,
// no user.email, a merge in progress), the index is put back as it was, so a
// failed commit stages nothing. The message is kept as written, `#` lines
// too (an issue reference), only trimmed. `author` (authorOf) names who
// made it, when someone signed in did.
export async function commitChanges(root: string, { message, paths }: CommitRequest, author: string | null = null): Promise<Commit> {
  const text = typeof message === 'string' ? message.trim() : '';
  if (text === '') throw new HttpError(400, 'write a commit message');
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS || !paths.every((path) => typeof path === 'string')) {
    throw new HttpError(400, 'paths must be a non-empty list of changed files');
  }
  const { branch, files } = await loadChanges(root);
  if (branch === null || branch === MAIN_BRANCH) throw new HttpError(409, `commit in a change request, not on ${branch ?? 'a detached HEAD'}`);
  const changed = new Map(files.map((file) => [file.path, file]));
  const specs = new Set<string>();
  for (const path of new Set(paths)) {
    const file = changed.get(path);
    if (!file) throw new HttpError(400, `${path} has no change to commit`);
    specs.add(path);
    if (file.from !== undefined) specs.add(file.from);
  }
  // Fails on a merge in progress (unmerged entries), before anything changed.
  const index = (await runGit(root, ['write-tree'])).trim();
  try {
    const onDisk = [...specs].filter((path) => existsSync(join(root, path)));
    if (onDisk.length > 0) await runGit(root, ['add', '--all', '--', ...onDisk]);
    await runGit(root, ['commit', '--quiet', '--cleanup=whitespace', ...(author === null ? [] : [`--author=${author}`]), '-m', text, '--', ...specs]);
  } catch (error) {
    await runGit(root, ['read-tree', index]);
    throw error;
  }
  const [made] = await readCommits(root, ['-1', 'HEAD', '--']);
  return made;
}
