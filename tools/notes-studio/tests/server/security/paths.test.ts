import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyPath, resolveWorktreePath } from '../../../server/security/paths';
import { isTextPath } from '../../../server/security/asset-types';
import { makeWorktree, type Worktree } from '../../support/studio';

describe('classifyPath', () => {
  it.each([
    ['content/notes/index.mdx', 'note'],
    ['content/notes/streaming/kafka/index.mdx', 'note'],
    ['content/notes/meta.yaml', 'meta'],
    ['content/notes/streaming/meta.yaml', 'meta'],
    ['public/notes/data-modeling/star.png', 'asset'],
    ['public/notes/x/diagram.HTML', 'asset'],
    ['public/notes/x/model.glb', 'asset'],
  ])('allows %s as %s', (path, kind) => {
    expect(classifyPath(path)).toBe(kind);
  });

  it.each([
    // outside content/notes and public/notes
    'package.json',
    'content/other/a.mdx',
    'content/notes-old/a.mdx',
    'public/resume/index.html',
    'public/notes.png',
    // traversal and odd spellings
    '../package.json',
    'content/notes/../../package.json',
    'content/notes/./a.mdx',
    'content/notes//a.mdx',
    '/content/notes/a.mdx',
    'content\\notes\\a.mdx',
    'content/notes/a.mdx\0.png',
    '',
    // hidden paths
    'content/notes/.obsidian/app.json',
    'content/notes/.obsidian/a.mdx',
    'content/notes/.draft.mdx',
    'public/notes/.cache/a.png',
    // unknown extensions
    'content/notes/a.md',
    'content/notes/a.js',
    'content/notes/a.mdx.bak',
    'content/notes/other.yaml',
    'content/notes/meta.json',
    'public/notes/a.js',
    'public/notes/a.exe',
    'public/notes/meta.yaml',
    // names of Object.prototype, which are not types
    'public/notes/a.constructor',
    'public/notes/a.__proto__',
    'public/notes/a.tostring',
  ])('rejects %j', (path) => {
    expect(classifyPath(path)).toBeNull();
  });
});

describe('isTextPath', () => {
  it('reads notes, meta.yaml, SVG and HTML as text, other assets and other paths not', () => {
    for (const path of ['content/notes/a.mdx', 'content/notes/a/meta.yaml', 'public/notes/a/b.svg', 'public/notes/a/b.html']) expect(isTextPath(path)).toBe(true);
    for (const path of ['public/notes/a/b.png', 'public/notes/a/b.pdf', 'package.json', 'content/notes/../x.mdx']) expect(isTextPath(path)).toBe(false);
  });
});

describe('resolveWorktreePath', () => {
  let worktree: Worktree;

  beforeAll(async () => {
    worktree = await makeWorktree();
    await mkdir(join(worktree.root, 'outside'));
    await writeFile(join(worktree.root, 'outside/secret.mdx'), 'secret');
    await symlink(join(worktree.root, 'outside/secret.mdx'), join(worktree.root, 'content/notes/link.mdx'));
    await symlink(join(worktree.root, 'outside'), join(worktree.root, 'content/notes/linked-dir'));
    await symlink(join(worktree.root, 'content/notes/index.mdx'), join(worktree.root, 'content/notes/inside-link.mdx'));
    await symlink(join(worktree.root, 'not-created-yet'), join(worktree.root, 'content/notes/dangling'));
    await mkdir(join(worktree.root, 'content/notes/folder.mdx'));
  });

  afterAll(async () => {
    await worktree.remove();
  });

  it('resolves an allowed path inside the worktree', () => {
    const resolved = resolveWorktreePath(worktree.root, 'content/notes/index.mdx');
    expect(resolved).toEqual({ kind: 'note', absolute: join(worktree.root, 'content/notes/index.mdx') });
  });

  it('resolves a file that does not exist yet', () => {
    const resolved = resolveWorktreePath(worktree.root, 'content/notes/new-folder/new.mdx');
    expect(resolved?.kind).toBe('note');
  });

  it('rejects symlinks that leave the allowed area', () => {
    expect(resolveWorktreePath(worktree.root, 'content/notes/link.mdx')).toBeNull();
    expect(resolveWorktreePath(worktree.root, 'content/notes/linked-dir/secret.mdx')).toBeNull();
    expect(resolveWorktreePath(worktree.root, 'content/notes/linked-dir/new.mdx')).toBeNull();
  });

  it('rejects symlinks that stay inside the area, since a save would replace the link', () => {
    expect(resolveWorktreePath(worktree.root, 'content/notes/inside-link.mdx')).toBeNull();
  });

  it('rejects a new file under a dangling symlinked folder', () => {
    expect(resolveWorktreePath(worktree.root, 'content/notes/dangling/new.mdx')).toBeNull();
  });

  it('rejects a folder named like a note', () => {
    expect(resolveWorktreePath(worktree.root, 'content/notes/folder.mdx')).toBeNull();
  });

  it('rejects paths the policy rejects', () => {
    expect(resolveWorktreePath(worktree.root, 'package.json')).toBeNull();
  });
});
