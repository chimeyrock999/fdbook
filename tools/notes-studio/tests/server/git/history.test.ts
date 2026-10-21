import { describe, expect, it } from 'vitest';
import { parseLog } from '../../../server/git/history';

describe('parseLog', () => {
  it('reads commits from git log -z, paths as they are', () => {
    const output = [
      '\x1eaaa\x1f2026-10-22T09:00:00+07:00\x1fdocs(notes): two\0\nD\0content/notes/b.mdx\0M\0content/notes/say "hi"\tnow.mdx\0',
      '\x1ebbb\x1f2026-10-22T08:00:00+07:00\x1fdocs(notes): one\0\nA\0content/notes/a.mdx\0T\0public/notes/x.png\0',
      '\x1eccc\x1f2026-10-22T07:00:00+07:00\x1fempty\0',
    ].join('');
    expect(parseLog(output)).toEqual([
      { sha: 'aaa', date: '2026-10-22T09:00:00+07:00', message: 'docs(notes): two', files: [
        { status: 'D', path: 'content/notes/b.mdx' },
        { status: 'M', path: 'content/notes/say "hi"\tnow.mdx' },
      ] },
      { sha: 'bbb', date: '2026-10-22T08:00:00+07:00', message: 'docs(notes): one', files: [
        { status: 'A', path: 'content/notes/a.mdx' },
        { status: 'M', path: 'public/notes/x.png' },
      ] },
      { sha: 'ccc', date: '2026-10-22T07:00:00+07:00', message: 'empty', files: [] },
    ]);
  });
});
