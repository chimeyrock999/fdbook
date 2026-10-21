import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { join } from 'node:path';
import { repoRoot } from '../../server/config';

// Every note in content/notes, with its source.
export async function realNotes(): Promise<{ path: string; source: string }[]> {
  const out: { path: string; source: string }[] = [];
  for await (const path of glob('content/notes/**/*.mdx', { cwd: repoRoot })) {
    out.push({ path, source: await readFile(join(repoRoot, path), 'utf8') });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
