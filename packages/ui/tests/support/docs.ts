import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// FdBook's own docs, for the tests that run in jsdom: there import.meta.url is
// not a file URL, so @fdbook/testing's docsRoot (from the server's config)
// cannot load. The same folder, from packages/ui/tests/support.
export const docsDir = join(import.meta.dirname, '../../../../docs');

// A file of the docs project by its path in a worktree (`diagrams/…`,
// `content/docs/…`).
export const readDoc = (path: string) => readFileSync(join(docsDir, path), 'utf8');
