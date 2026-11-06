import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { git } from '#infra/command.ts';

// The worktree path (posix) an absolute path names, or null outside it.
export function worktreePathOf(root: string, path: string) {
  if (!isAbsolute(path)) return null;
  const rest = relative(root, path);
  if (rest === '' || rest.startsWith('..') || isAbsolute(rest)) return null;
  return rest.split(sep).join('/');
}

// The files that differ from HEAD (changed, added, deleted, untracked; not
// ignored ones), each with its mtime, null once deleted. An agent's own
// tools (Claude Code's Edit, Codex's shell) write without asking the
// Studio: comparing this before and after a run is how the Studio learns
// what they changed.
export async function worktreeState(root: string): Promise<Map<string, number | null>> {
  const output = await git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames');
  const paths = output.split('\0').filter((entry) => entry.length > 3).map((entry) => entry.slice(3));
  const state = new Map<string, number | null>();
  await Promise.all(paths.map(async (path) => {
    state.set(path, await stat(join(root, path)).then((info) => info.mtimeMs, () => null));
  }));
  return state;
}

// What changed between two states: files that changed, appeared or went
// back to HEAD.
export function changedSince(before: Map<string, number | null>, after: Map<string, number | null>): string[] {
  const changed = new Set<string>();
  for (const [path, mtime] of after) if (!before.has(path) || before.get(path) !== mtime) changed.add(path);
  for (const path of before.keys()) if (!after.has(path)) changed.add(path);
  return [...changed].sort();
}
