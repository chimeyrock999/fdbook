import { assertWorktreeTop, runGit } from './git.ts';

// A commit as the Changes view lists it: the subject line, the committer
// date (ISO 8601) and its files against its parent.
export type CommitFile = { status: 'M' | 'A' | 'D'; path: string };
export type Commit = { sha: string; date: string; message: string; files: CommitFile[] };
// `base` is the ref the change request started from, or null when the
// worktree has none (then there is no history to show).
export type History = { base: string | null; commits: Commit[] };

// Where change requests start: the remote's main, or the local one.
const BASES = ['origin/main', 'main'];
const LIMIT = 200;

const RECORD = '\x1e';
const FIELD = '\x1f';

// Reads `git log -z --format=<RECORD>%H<FIELD>%cI<FIELD>%s --name-status
// --no-renames`: one record per commit, its header, then NUL-separated
// status and path pairs (the first status after a newline). -z keeps paths
// as they are: without it git quotes a path with `"` or a control character.
export function parseLog(output: string): Commit[] {
  return output.split(RECORD).slice(1).map((record) => {
    const [header, ...tokens] = record.split('\0');
    const [sha, date, message] = header.split(FIELD);
    const files: CommitFile[] = [];
    for (let index = 0; index + 1 < tokens.length; index += 2) {
      const code = tokens[index].trim();
      if (code === '') break;
      files.push({ status: code === 'A' || code === 'D' ? code : 'M', path: tokens[index + 1] });
    }
    return { sha, date, message, files };
  });
}

export async function readCommits(root: string, range: string[]) {
  return parseLog(await runGit(root, ['log', '-z', `--format=${RECORD}%H${FIELD}%cI${FIELD}%s`, '--name-status', '--no-renames', ...range]));
}

async function baseOf(root: string) {
  for (const ref of BASES) {
    const found = await runGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).then(() => true, () => false);
    if (found) return ref;
  }
  return null;
}

// The change request's own commits: those on HEAD and not on its base,
// newest first. Merges (main merged in to catch up) are not its own work.
export async function loadHistory(root: string): Promise<History> {
  await assertWorktreeTop(root);
  const base = await baseOf(root);
  if (base === null) return { base, commits: [] };
  return { base, commits: await readCommits(root, ['--no-merges', `-n${String(LIMIT)}`, `${base}..HEAD`, '--']) };
}
