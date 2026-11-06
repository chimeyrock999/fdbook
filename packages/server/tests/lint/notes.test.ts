import { describe, expect, it } from 'vitest';
import { loadLintContexts } from '#lint/context.ts';
import { lintNote } from '#lint/lint.ts';
import { docsRoot, realNotes } from '@fdbook/testing/notes.ts';
import { docsPageCount } from '#tests/support/docs.ts';

// The acceptance bar of the lint: on every page of the docs it reports no
// issue that is not a real one. Run on the real content/docs and public/,
// one test per note so each stays inside the default timeout.
const notes = await realNotes();
const contextOf = await loadLintContexts(docsRoot);

describe('lint on content/docs', () => {
  it('finds every note', async () => {
    expect(notes.length).toBe(await docsPageCount());
  });

  it.each(notes)('finds nothing to report in $path', ({ path, source }) => {
    const issues = lintNote(source, contextOf(path.slice('content/docs/'.length)));
    expect(issues.map((issue) => `${String(issue.start.line)} ${issue.rule} ${issue.message}`)).toEqual([]);
  });
});
