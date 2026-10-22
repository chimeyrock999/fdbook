import { readFile } from 'node:fs/promises';
import type { StudioFiles } from '../mcp/tool.ts';
import { resolveWorktreePath } from '../security/paths.ts';
import { createKeyedLock, statOrNull, writeAtomic } from './store.ts';

// A write from a stale base: what the disk holds now (null content for an
// asset or a missing file, null mtime for a missing file).
export class FileConflictError extends Error {
  content: string | null;
  mtimeMs: number | null;
  constructor(path: string, content: string | null, mtimeMs: number | null) {
    super(`${path} changed on disk`);
    this.content = content;
    this.mtimeMs = mtimeMs;
  }
}

// A path the policy refuses (server/security/paths.ts).
export class PathRefusedError extends Error {}

export type StudioFilesOptions = {
  // Saves to one file, one at a time: shared with the file API so two saves
  // from the same base cannot both pass the mtime check.
  pathLock?: ReturnType<typeof createKeyedLock>;
  // The worktree's notes lock (workspace.ts): a write waits for renames and
  // commits. The file API saves without it, as the editor always has.
  notesLock?: ReturnType<typeof createKeyedLock> | null;
  // Told the path and what it held (null: missing) just before a write
  // replaces it: a run's Keep/Revert list (agents/watch.ts).
  beforeWrite?: (path: string, previous: Buffer | null) => void;
};

// Reads and writes of the worktree at `root` through the path policy, with
// the mtime check of the file API: what the file API and the Studio's MCP
// tools both use.
export function createStudioFiles(root: string, { pathLock = createKeyedLock(), notesLock = null, beforeWrite }: StudioFilesOptions = {}): StudioFiles {
  const resolve = (path: string) => {
    const resolved = resolveWorktreePath(root, path);
    if (resolved === null) throw new PathRefusedError(`not an editable path: ${path}`);
    return resolved;
  };
  const readBytes = async (path: string) => {
    const { absolute } = resolve(path);
    const info = await statOrNull(absolute);
    if (!info?.isFile()) return null;
    return { data: await readFile(absolute), mtimeMs: info.mtimeMs };
  };
  const locked = <T>(task: () => Promise<T>) => (notesLock === null ? task() : notesLock('notes', task));

  return {
    async read(path) {
      const file = await readBytes(path);
      return file === null ? null : { content: file.data.toString('utf8'), mtimeMs: file.mtimeMs };
    },
    readBytes,
    write(path, content, { baseMtime } = {}) {
      const { kind, absolute } = resolve(path);
      return locked(() => pathLock(absolute, async () => {
        const info = await statOrNull(absolute);
        if (info !== null && !info.isFile()) throw new PathRefusedError(`not a file: ${path}`);
        const diskMtime = info?.mtimeMs ?? null;
        if (baseMtime !== undefined && diskMtime !== baseMtime) {
          throw new FileConflictError(path, info && kind !== 'asset' ? await readFile(absolute, 'utf8') : null, diskMtime);
        }
        beforeWrite?.(path, info === null ? null : await readFile(absolute));
        return { mtimeMs: await writeAtomic(absolute, content, info?.mode) };
      }));
    },
  };
}
