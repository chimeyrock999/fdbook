import { readFile } from 'node:fs/promises';
import { resolveWorktreePath } from '#security/paths.ts';
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

// A worktree's files, as an MCP tool gets them in its context (mcp/tool.ts).
export type StudioFiles = {
  // Paths are worktree-relative posix and go through the path policy (resolveWorktreePath); null = missing.
  read(path: string): Promise<{ content: string; mtimeMs: number } | null>;
  readBytes(path: string): Promise<{ data: Buffer; mtimeMs: number } | null>;
  // Under the worktree's notes lock. baseMtime: null = must not exist yet; undefined = no check.
  // A mismatch throws FileConflictError { content, mtimeMs } (the file API's 409). A run's writes go on its Keep/Revert list.
  write(path: string, content: string | Buffer, opts?: { baseMtime?: number | null }): Promise<{ mtimeMs: number }>;
};

// A path the policy refuses (server/security/paths.ts).
export class PathRefusedError extends Error {}

export type StudioFilesOptions = {
  // Saves to one file, one at a time: shared with the file API so two saves
  // from the same base cannot both pass the mtime check.
  pathLock?: ReturnType<typeof createKeyedLock>;
  // The worktree's notes lock (app/workspace.ts): a write waits for renames and
  // commits. The file API saves without it, as the editor always has.
  notesLock?: ReturnType<typeof createKeyedLock> | null;
  // Told the path and what it held (null: missing) just before a write
  // replaces it: a run's Keep/Revert list (agents/watch.ts).
  beforeWrite?: (path: string, previous: Buffer | null) => void;
  // Told the path and its new content once a write replaced it; the write
  // answers once it is done.
  afterWrite?: (path: string, content: Buffer) => void | Promise<void>;
  // Told the path just before a person's save replaces it (the file API):
  // the runs going on must not revert it (agents/watch.ts).
  beforeSave?: (path: string) => void;
};

// Reads and writes of the worktree at `root` through the path policy, with
// the mtime check of the file API: what the file API and the Studio's MCP
// tools both use.
export function createStudioFiles(root: string, { pathLock = createKeyedLock(), notesLock = null, beforeWrite, afterWrite, beforeSave }: StudioFilesOptions = {}): StudioFiles {
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
        beforeSave?.(path);
        const mtimeMs = await writeAtomic(absolute, content, info?.mode);
        await afterWrite?.(path, typeof content === 'string' ? Buffer.from(content) : content);
        return { mtimeMs };
      }));
    },
  };
}
