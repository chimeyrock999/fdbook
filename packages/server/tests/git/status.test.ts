import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadChanges, parseStatus } from '#git/status.ts';
import { git, makeGitWorktree } from '@fdbook/testing/git.ts';
import type { Worktree } from '@fdbook/testing/studio.ts';

const NUL = '\0';

describe('parseStatus', () => {
  it('reads the branch and folds the index and the worktree into one status against HEAD', () => {
    const output = [
      '# branch.oid 0123456789abcdef0123456789abcdef01234567',
      '# branch.head cr/sinks',
      '1 .M N... 100644 100644 100644 aaa aaa content/docs/a.mdx',
      '1 M. N... 100644 100644 100644 aaa bbb content/docs/b.mdx',
      '1 A. N... 000000 100644 100644 000 bbb content/docs/c.mdx',
      '1 .D N... 100644 100644 000000 aaa aaa content/docs/d.mdx',
      '1 D. N... 100644 000000 000000 aaa 000 content/docs/e.mdx',
      '2 R. N... 100644 100644 100644 aaa aaa R100 content/docs/new.mdx',
      'content/docs/old.mdx',
      '? public/docs/s/pic.png',
      '',
    ].join(NUL);
    expect(parseStatus(output)).toMatchObject({
      branch: 'cr/sinks',
      files: [
        { path: 'content/docs/a.mdx', status: 'M' },
        { path: 'content/docs/b.mdx', status: 'M' },
        { path: 'content/docs/c.mdx', status: 'A' },
        { path: 'content/docs/d.mdx', status: 'D' },
        { path: 'content/docs/e.mdx', status: 'D' },
        { path: 'content/docs/new.mdx', status: 'R', from: 'content/docs/old.mdx' },
        { path: 'public/docs/s/pic.png', status: 'A' },
      ],
    });
  });

  it('drops a file added and then deleted, and keeps unmerged files as modified', () => {
    const output = [
      '# branch.head (detached)',
      '1 AD N... 000000 100644 000000 000 bbb content/docs/gone.mdx',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc content/docs/both.mdx',
      '',
    ].join(NUL);
    expect(parseStatus(output)).toEqual({ branch: null, files: [{ path: 'content/docs/both.mdx', status: 'M' }], recheck: [] });
  });

  it('lists a file the index deletes but the disk keeps once, as modified, to be checked against HEAD', () => {
    const output = [
      '# branch.head cr/x',
      '1 D. N... 100644 000000 000000 aaa 000 content/docs/kept.mdx',
      '? content/docs/kept.mdx',
      '',
    ].join(NUL);
    expect(parseStatus(output)).toEqual({ branch: 'cr/x', files: [{ path: 'content/docs/kept.mdx', status: 'M' }], recheck: ['content/docs/kept.mdx'] });
  });

  it('keeps only the end of a rename the Studio may edit', () => {
    const output = [
      '# branch.head cr/x',
      '2 R. N... 100644 100644 100644 aaa aaa R100 content/docs/a.md',
      'content/docs/a.mdx',
      '2 R. N... 100644 100644 100644 aaa aaa R100 content/docs/x.mdx',
      'docs/x.mdx',
      '',
    ].join(NUL);
    expect(parseStatus(output).files).toEqual([
      { path: 'content/docs/a.mdx', status: 'D' },
      { path: 'content/docs/x.mdx', status: 'A' },
    ]);
  });

  it('keeps only what the Studio may edit', () => {
    const output = [
      '# branch.head main',
      '? content/docs/.DS_Store',
      '? content/docs/draft.txt',
      '? public/docs/x/data.csv',
      '? content/docs/x/meta.yaml',
      '',
    ].join(NUL);
    expect(parseStatus(output).files).toEqual([{ path: 'content/docs/x/meta.yaml', status: 'A' }]);
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
    await write('content/docs/diagrams/index.mdx', '---\ntitle: Diagrams\n---\n\nChanged.\n');
    await write('content/docs/diagrams/new-page.mdx', '---\ntitle: New\n---\n');
    await rm(join(worktree.root, 'content/docs/reference/lint.mdx'));
    await write('public/docs/diagrams/new.png', 'png');
    await write('package.json', '{"changed":true}\n');
    await write('content/docs/notes.txt', 'not a note');
    expect(await loadChanges(worktree.root)).toEqual({
      branch: 'cr/test',
      files: [
        { path: 'content/docs/diagrams/index.mdx', status: 'M' },
        { path: 'content/docs/diagrams/new-page.mdx', status: 'A' },
        { path: 'content/docs/reference/lint.mdx', status: 'D' },
        { path: 'public/docs/diagrams/new.png', status: 'A' },
      ],
    });
  });

  it('shows a rename staged in a terminal as one entry', async () => {
    git(worktree.root, 'mv', 'content/docs/diagrams/examples.mdx', 'content/docs/diagrams/samples.mdx');
    expect((await loadChanges(worktree.root)).files).toEqual([
      { path: 'content/docs/diagrams/samples.mdx', status: 'R', from: 'content/docs/diagrams/examples.mdx' },
    ]);
  });

  it('lists a file taken out of the index once: modified if it differs from HEAD, else not at all', async () => {
    git(worktree.root, 'rm', '-q', '--cached', 'content/docs/diagrams/index.mdx', 'content/docs/guide/setup.mdx');
    await write('content/docs/diagrams/index.mdx', 'changed\n');
    expect((await loadChanges(worktree.root)).files).toEqual([{ path: 'content/docs/diagrams/index.mdx', status: 'M' }]);
  });

  it('refuses a root that is not the top of a git worktree', async () => {
    await expect(loadChanges(join(worktree.root, 'content'))).rejects.toThrow(/not the top of a git worktree/);
  });
});
