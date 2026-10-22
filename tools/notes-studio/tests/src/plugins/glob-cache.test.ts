import { glob, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../../server/config';

// vitest 5.0.5 keeps a module in its on-disk cache unless it calls
// `import.meta.glob(`; the typed form `import.meta.glob<T>(` slips past that
// check, so tests keep an old plugin list after a plugin folder is added
// (vitest-dev/vitest PR 11666, not released yet). Write it untyped.
describe('import.meta.glob', () => {
  it('is never called with a type argument', async () => {
    const studio = join(repoRoot, 'tools/notes-studio');
    const typed: string[] = [];
    for await (const file of glob('src/**/*.{ts,tsx}', { cwd: studio })) {
      if (/import\.meta\.glob\s*</.test(await readFile(join(studio, file), 'utf8'))) typed.push(file);
    }
    expect(typed).toEqual([]);
  });
});
