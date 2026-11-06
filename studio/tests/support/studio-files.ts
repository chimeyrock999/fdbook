import { readFile, stat } from 'node:fs/promises';
import { writeAtomic } from '../../server/files/store';
import type { StudioFiles, StudioToolContext } from '../../server/mcp/tool';
import { resolveWorktreePath } from '../../server/security/paths';

// A StudioFiles with the contract's shape (server/mcp/tool.ts) over a
// worktree, for testing tools before the MCP host's own one lands: the path
// policy, and a write refused with a FileConflictError when the disk moved
// on since `baseMtime`.
export class FileConflictError extends Error {
  constructor(readonly content: string | null, readonly mtimeMs: number | null) {
    super('the file changed on disk');
    this.name = 'FileConflictError';
  }
}

export function testStudioFiles(root: string): StudioFiles {
  const resolve = (path: string) => {
    const resolved = resolveWorktreePath(root, path);
    if (!resolved) throw new Error(`not an editable path: ${path}`);
    return resolved.absolute;
  };
  const info = (absolute: string) => stat(absolute).catch(() => null);
  return {
    async read(path) {
      const absolute = resolve(path);
      const found = await info(absolute);
      return found ? { content: await readFile(absolute, 'utf8'), mtimeMs: found.mtimeMs } : null;
    },
    async readBytes(path) {
      const absolute = resolve(path);
      const found = await info(absolute);
      return found ? { data: await readFile(absolute), mtimeMs: found.mtimeMs } : null;
    },
    async write(path, content, { baseMtime } = {}) {
      const absolute = resolve(path);
      const found = await info(absolute);
      if (baseMtime !== undefined && (found?.mtimeMs ?? null) !== baseMtime) {
        throw new FileConflictError(found ? await readFile(absolute, 'utf8') : null, found?.mtimeMs ?? null);
      }
      return { mtimeMs: await writeAtomic(absolute, content, found?.mode) };
    },
  };
}

export function toolContext(root: string, caller: StudioToolContext['caller'] = { kind: 'person', login: null, role: 'admin' }): StudioToolContext {
  return { slug: 'test', root, caller, files: testStudioFiles(root), signal: new AbortController().signal };
}
