import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { statOrNull, writeAtomic } from '../files/store.ts';
import { runGitBytes } from '../git/git.ts';
import { classifyPath, resolveWorktreePath } from '../security/paths.ts';
import type { RunChange } from './shared.ts';

// The largest file whose earlier content a run keeps for a revert.
const MAX_BEFORE_BYTES = 25 * 1024 * 1024;

// What a file held before a run changed it: its bytes, or null when it did
// not exist. Kept per run next to its transcript, so Revert works after a
// restart too.
export type StoredChange = { path: string; before: string | null; endMtimeMs: number | null; decided: RunChange['decided']; reason: string | null };

async function readOrNull(path: string) {
  const info = await statOrNull(path);
  return info?.isFile() ? readFile(path) : null;
}

// What `path` holds in commit `sha`, null when it is not there.
const atCommit = (root: string, sha: string | null, path: string) =>
  sha === null ? Promise.resolve(null) : runGitBytes(root, ['show', `${sha}:${path}`], MAX_BEFORE_BYTES * 2).catch(() => null);

// Watches one run's worktree for Keep/Revert: what the files the Studio may
// edit held when the run started (those that differed from HEAD then; the
// others are as HEAD has them), and what a file held right before a write
// the run made through the Studio.
export function watchRun(root: string, dirty: Promise<Map<string, number | null>>) {
  // HEAD as the run found it: a commit made during the run must not become
  // what a revert goes back to.
  const head = runGitBytes(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).then((out) => out.toString('utf8').trim() || null, () => null);
  const snapshot = dirty.then(async (state) => {
    const kept = new Map<string, Buffer | null>();
    await Promise.all([...state.keys()].filter((path) => classifyPath(path) !== null).map(async (path) => {
      const info = await statOrNull(join(root, path));
      if (info !== null && info.size > MAX_BEFORE_BYTES) return;
      kept.set(path, await readOrNull(join(root, path)));
    }));
    return kept;
  });
  snapshot.catch(() => undefined);
  const written = new Map<string, Buffer | null>();

  return {
    // Settles once the run's start is recorded: the prompt waits for it, so
    // the agent cannot change a file before its earlier version is kept.
    ready: Promise.all([head, snapshot]).then(() => undefined, () => undefined),

    // fs writes and MCP tool writes call this before replacing a file.
    beforeWrite(path: string, previous: Buffer | null) {
      if (!written.has(path)) written.set(path, previous);
    },

    // The run's changes as kept for Keep/Revert, once it ended. Paths the
    // Studio may not edit are listed but cannot be reverted here.
    async settle(paths: string[]): Promise<StoredChange[]> {
      const [start, sha] = await Promise.all([snapshot.catch(() => new Map<string, Buffer | null>()), head]);
      return Promise.all(paths.map(async (path): Promise<StoredChange> => {
        const end = await statOrNull(join(root, path));
        const endMtimeMs = end?.mtimeMs ?? null;
        if (classifyPath(path) === null) return { path, before: null, endMtimeMs, decided: null, reason: 'outside the notes and their assets: revert it by hand' };
        const before = written.has(path) ? written.get(path) ?? null : start.has(path) ? start.get(path) ?? null : await atCommit(root, sha, path);
        if (before !== null && before.length > MAX_BEFORE_BYTES) return { path, before: null, endMtimeMs, decided: null, reason: 'too large to keep its earlier version' };
        return { path, before: before === null ? null : before.toString('base64'), endMtimeMs, decided: null, reason: null };
      }));
    },
  };
}

export type RunWatch = ReturnType<typeof watchRun>;

// Puts `change.path` back as it was before the run: only when it is still
// as the run left it, so a later edit is never lost.
export async function revertChange(root: string, change: StoredChange) {
  if (change.reason !== null) throw new Error(change.reason);
  const resolved = resolveWorktreePath(root, change.path);
  if (resolved === null) throw new Error(`not an editable path: ${change.path}`);
  const now = (await statOrNull(resolved.absolute))?.mtimeMs ?? null;
  if (now !== change.endMtimeMs) return false;
  if (change.before === null) await rm(resolved.absolute, { force: true });
  else await writeAtomic(resolved.absolute, Buffer.from(change.before, 'base64'));
  return true;
}
