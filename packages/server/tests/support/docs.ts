import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { docsRoot } from '@fdbook/testing/notes.ts';

// The number of pages in FdBook's docs, counted apart from realNotes()'s
// glob, so a test can check that the glob found every one of them.
export async function docsPageCount() {
  const entries = await readdir(join(docsRoot, 'content/docs'), { recursive: true });
  return entries.filter((entry) => entry.endsWith('.mdx')).length;
}
