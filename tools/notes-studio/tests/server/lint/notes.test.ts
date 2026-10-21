import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../../server/config';
import { lintWorktree } from '../../../server/lint/context';

// The acceptance bar of the lint: on every note in the repo it reports no
// issue that is not a real one. Run on the real content/notes and public/.
describe('lint on content/notes', () => {
  it('finds nothing to report', async () => {
    const results = await lintWorktree(repoRoot);
    expect(results.length).toBeGreaterThan(50);
    const found = results.flatMap(({ path, issues }) =>
      issues.map((issue) => `${path}:${String(issue.start.line)} ${issue.rule} ${issue.message}`),
    );
    expect(found).toEqual([]);
  });
});
