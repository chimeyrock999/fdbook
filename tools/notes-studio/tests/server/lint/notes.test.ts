import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../../server/config';
import { loadLintContext } from '../../../server/lint/context';
import { lintNote } from '../../../server/lint/lint';
import { realNotes } from '../../support/notes';

// The acceptance bar of the lint: on every note in the repo it reports no
// issue that is not a real one. Run on the real content/notes and public/,
// one test per note so each stays inside the default timeout.
const notes = await realNotes();

describe('lint on content/notes', () => {
  it('finds every note', () => {
    expect(notes.length).toBeGreaterThan(50);
  });

  it.each(notes)('finds nothing to report in $path', async ({ path, source }) => {
    const issues = lintNote(source, await loadLintContext(repoRoot, path.slice('content/notes/'.length)));
    expect(issues.map((issue) => `${String(issue.start.line)} ${issue.rule} ${issue.message}`)).toEqual([]);
  });
});
