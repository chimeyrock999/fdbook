import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadChanges, parseStatus } from '../../../server/git/status';
import { git, makeGitWorktree } from '../../support/git';
import type { Worktree } from '../../support/studio';

const NUL = '\0';

describe('parseStatus', () => {
  it('reads the branch and folds the index and the worktree into one status against HEAD', () => {
    const output = [
      '# branch.oid 0123456789abcdef0123456789abcdef01234567',
      '# branch.head cr/sinks',
      '1 .M N... 100644 100644 100644 aaa aaa content/notes/a.mdx',
      '1 M. N... 100644 100644 100644 aaa bbb content/notes/b.mdx',
      '1 A. N... 000000 100644 100644 000 bbb content/notes/c.mdx',
      '1 .D N... 100644 100644 000000 aaa aaa content/notes/d.mdx',
      '1 D. N... 100644 000000 000000 aaa 000 content/notes/e.mdx',
      '2 R. N... 100644 100644 100644 aaa aaa R100 content/notes/new.mdx',
      'content/notes/old.mdx',
      '? public/notes/s/pic.png',
      '',
    ].join(NUL);
    expect(parseStatus(output)).toEqual({
      branch: 'cr/sinks',
      files: [
        { path: 'content/notes/a.mdx', status: 'M' },
        { path: 'content/notes/b.mdx', status: 'M' },
        { path: 'content/notes/c.mdx', status: 'A' },
        { path: 'content/notes/d.mdx', status: 'D' },
        { path: 'content/notes/e.mdx', status: 'D' },
        { path: 'content/notes/new.mdx', status: 'R', from: 'content/notes/old.mdx' },
        { path: 'public/notes/s/pic.png', status: 'A' },
      ],
    });
  });

  it('drops a file added and then deleted, and keeps unmerged files as modified', () => {
    const output = [
      '# branch.head (detached)',
      '1 AD N... 000000 100644 000000 000 bbb content/notes/gone.mdx',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc content/notes/both.mdx',
      '',
    ].join(NUL);
    expect(parseStatus(output)).toEqual({ branch: null, files: [{ path: 'content/notes/both.mdx', status: 'M' }] });
  });

  it('keeps only the end of a rename the Studio may edit', () => {
    const output = [
      '# branch.head cr/x',
      '2 R. N... 100644 100644 100644 aaa aaa R100 content/notes/a.md',
      'content/notes/a.mdx',
      '2 R. N... 100644 100644 100644 aaa aaa R100 content/notes/x.mdx',
      'docs/x.mdx',
      '',
    ].join(NUL);
    expect(parseStatus(output).files).toEqual([
      { path: 'content/notes/a.mdx', status: 'D' },
      { path: 'content/notes/x.mdx', status: 'A' },
    ]);
  });

  it('keeps only what the Studio may edit', () => {
    const output = [
      '# branch.head main',
      '? content/notes/.DS_Store',
      '? content/notes/draft.txt',
      '? public/notes/x/data.csv',
      '? content/notes/x/meta.yaml',
      '',
    ].join(NUL);
    expect(parseStatus(output).files).toEqual([{ path: 'content/notes/x/meta.yaml', status: 'A' }]);
  });
});

describe('loadChanges', () => {
  let worktree: Worktree;
  const write = async (path: string, text: string) => {
    await mkdir(join(worktree.root, path, '..'), { recursive: true });
    await writeFile(join(worktree.root, path), text);
  };

  beforeEach(async () => {
    worktree = await makeGitWorktree();
  });
  afterEach(async () => {
    await worktree.remove();
  });

  it('is empty on a clean change request', async () => {
    expect(await loadChanges(worktree.root)).toEqual({ branch: 'cr/test', files: [] });
  });

  it('lists notes, meta.yaml and assets changed in the worktree, nothing else', async () => {
    await write('content/notes/streaming/index.mdx', '---\ntitle: Streaming\n---\n\nChanged.\n');
    await write('content/notes/streaming/new-page.mdx', '---\ntitle: New\n---\n');
    await rm(join(worktree.root, 'content/notes/distributed-systems/rpc-and-threads.mdx'));
    await write('public/notes/streaming/new.png', 'png');
    await write('package.json', '{"changed":true}\n');
    await write('content/notes/notes.txt', 'not a note');
    expect(await loadChanges(worktree.root)).toEqual({
      branch: 'cr/test',
      files: [
        { path: 'content/notes/distributed-systems/rpc-and-threads.mdx', status: 'D' },
        { path: 'content/notes/streaming/index.mdx', status: 'M' },
        { path: 'content/notes/streaming/new-page.mdx', status: 'A' },
        { path: 'public/notes/streaming/new.png', status: 'A' },
      ],
    });
  });

  it('shows a rename staged in a terminal as one entry', async () => {
    git(worktree.root, 'mv', 'content/notes/streaming/watermark-and-late-events.mdx', 'content/notes/streaming/watermarks.mdx');
    expect((await loadChanges(worktree.root)).files).toEqual([
      { path: 'content/notes/streaming/watermarks.mdx', status: 'R', from: 'content/notes/streaming/watermark-and-late-events.mdx' },
    ]);
  });

  it('refuses a root that is not the top of a git worktree', async () => {
    await expect(loadChanges(join(worktree.root, 'content'))).rejects.toThrow(/not the top of a git worktree/);
  });
});
