import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { join } from 'node:path';
import { installRoot } from '../../server/config';

// FdBook's own docs (docs/, a project with the default areas): the pages the
// tests read and copy as real content.
export const docsRoot = join(installRoot, 'docs');

// Every page in docs/content/docs, with its source; `path` is relative to
// docsRoot, as in a worktree (`content/docs/…`).
export async function realNotes(): Promise<{ path: string; source: string }[]> {
  const out: { path: string; source: string }[] = [];
  for await (const path of glob('content/docs/**/*.mdx', { cwd: docsRoot })) {
    out.push({ path, source: await readFile(join(docsRoot, path), 'utf8') });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
