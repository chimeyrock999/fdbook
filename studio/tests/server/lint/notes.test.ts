import { describe, expect, it } from 'vitest';
import { loadLintContexts } from '../../../server/lint/context';
import { lintNote } from '../../../server/lint/lint';
import { docsRoot, realNotes } from '../../support/notes';

// The acceptance bar of the lint: on every note in the repo it reports no
// issue that is not a real one. Run on the real content/docs and public/,
// one test per note so each stays inside the default timeout.
const notes = await realNotes();
const contextOf = await loadLintContexts(docsRoot);

describe('lint on content/docs', () => {
  it('finds every note', () => {
    expect(notes.length).toBeGreaterThan(50);
  });

  it.each(notes)('finds nothing to report in $path', ({ path, source }) => {
    const issues = lintNote(source, contextOf(path.slice('content/docs/'.length)));
    expect(issues.map((issue) => `${String(issue.start.line)} ${issue.rule} ${issue.message}`)).toEqual([]);
  });
});
