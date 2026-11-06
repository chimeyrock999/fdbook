import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { EDITABLE_AREAS, resolveWorktreePath, type PathKind } from '#infra/security/paths.ts';

export type EditableFile = { path: string; kind: PathKind; mtimeMs: number; size: number };

export async function statOrNull(path: string) {
  try {
    return await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

// Every file the Studio may edit in the worktree, sorted by path. Entries
// that vanish or cannot be read while listing are skipped.
export async function listEditableFiles(root: string) {
  const paths: string[] = [];
  for (const area of EDITABLE_AREAS) {
    const entries = await readdir(join(root, area), { recursive: true }).catch(() => []);
    for (const entry of entries) paths.push(`${area}/${entry.split('\\').join('/')}`);
  }
  const files = await Promise.all(
    paths.map(async (path): Promise<EditableFile | null> => {
      const resolved = resolveWorktreePath(root, path);
      if (!resolved) return null;
      const info = await stat(resolved.absolute).catch(() => null);
      return info?.isFile() ? { path, kind: resolved.kind, mtimeMs: info.mtimeMs, size: info.size } : null;
    }),
  );
  return files.filter((file) => file !== null).sort((a, b) => a.path.localeCompare(b.path));
}

// Write a hidden sibling and rename it over the file, so readers (the site's
// dev server, Obsidian, the watchers) never see a half-written file. The
// hidden name also keeps the temp file out of the file events. Returns the
// new mtime, read from the temp file before the rename so a write that lands
// right after it is not mistaken for this one.
export async function writeAtomic(absolute: string, data: string | Buffer, mode?: number) {
  await mkdir(dirname(absolute), { recursive: true });
  const temp = join(dirname(absolute), `.${basename(absolute)}.studio-${randomBytes(4).toString('hex')}`);
  try {
    await writeFile(temp, data);
    if (mode !== undefined) await chmod(temp, mode);
    const { mtimeMs } = await stat(temp);
    await rename(temp, absolute);
    return mtimeMs;
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

// Runs tasks for the same key one at a time.
export function createKeyedLock() {
  const queues = new Map<string, Promise<unknown>>();
  return <T>(key: string, task: () => Promise<T>) => {
    const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
    const settled = run.catch(() => undefined);
    queues.set(key, settled);
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return run;
  };
}
