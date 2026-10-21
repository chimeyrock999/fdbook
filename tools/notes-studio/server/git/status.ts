import { classifyPath } from '../security/paths.ts';
import { assertWorktreeTop, runGit } from './git.ts';

// A changed file against HEAD: modified, added (new or untracked), deleted,
// or renamed from `from` (a rename staged in a terminal; the Studio's own
// renames show as a delete and an add).
export type ChangeStatus = 'M' | 'A' | 'D' | 'R';
export type ChangedFile = { path: string; status: ChangeStatus; from?: string };
// `branch` is null on a detached HEAD.
export type Changes = { branch: string | null; files: ChangedFile[] };

const AREAS = ['content/notes', 'public/notes'];

// One status from git's index (X) and worktree (Y) columns.
function statusOf(xy: string): ChangeStatus | null {
  const [x, y] = xy;
  if (x === 'A') return y === 'D' ? null : 'A';
  return x === 'D' || y === 'D' ? 'D' : 'M';
}

// Reads `git status --porcelain=v2 -z --branch`. Entries are NUL-separated;
// a rename (`2`) is followed by its old path as an entry of its own. Only
// files the path policy allows are kept, so a .DS_Store or a stray .txt in
// content/notes never reaches a commit.
export function parseStatus(output: string): Changes {
  const entries = output.split('\0');
  let branch: string | null = null;
  const files: ChangedFile[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    let file: ChangedFile | null = null;
    if (entry.startsWith('# branch.head ')) {
      const head = entry.slice('# branch.head '.length);
      branch = head === '(detached)' ? null : head;
    } else if (entry.startsWith('1 ')) {
      // 1 XY sub mH mI mW hH hI path
      const fields = entry.split(' ');
      const status = statusOf(fields[1]);
      if (status) file = { path: fields.slice(8).join(' '), status };
    } else if (entry.startsWith('2 ')) {
      // 2 XY sub mH mI mW hH hI Xscore path, then the old path
      const fields = entry.split(' ');
      const path = fields.slice(9).join(' ');
      const from = entries[index + 1];
      index += 1;
      // A rename the path policy sees only one end of is that end alone:
      // a Studio commit must never touch a path outside it.
      if (fields[1][1] === 'D' || !classifyPath(path)) file = { path: from, status: 'D' };
      else file = classifyPath(from) ? { path, status: 'R', from } : { path, status: 'A' };
    } else if (entry.startsWith('u ')) {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      file = { path: entry.split(' ').slice(10).join(' '), status: 'M' };
    } else if (entry.startsWith('? ')) {
      file = { path: entry.slice(2), status: 'A' };
    }
    if (file && classifyPath(file.path)) files.push(file);
  }
  return { branch, files };
}

// What `git status` says changed under content/notes and public/notes, by path.
export async function loadChanges(root: string): Promise<Changes> {
  await assertWorktreeTop(root);
  const output = await runGit(root, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', '--', ...AREAS]);
  const changes = parseStatus(output);
  changes.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return changes;
}
