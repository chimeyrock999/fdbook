import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyPath, resolveWorktreePath } from '#infra/security/paths.ts';
import { isTextPath } from '@fdbook/shared/asset-types.ts';
import { makeWorktree, type Worktree } from '@fdbook/testing/studio.ts';

describe('classifyPath', () => {
  it.each([
    ['content/docs/index.mdx', 'note'],
    ['content/docs/streaming/kafka/index.mdx', 'note'],
    ['content/docs/meta.yaml', 'meta'],
    ['content/docs/streaming/meta.yaml', 'meta'],
    ['content/docs/meta.json', 'meta'],
    ['content/docs/streaming/meta.json', 'meta'],
    ['public/docs/data-modeling/star.png', 'asset'],
    ['public/docs/x/diagram.HTML', 'asset'],
    ['public/docs/x/model.glb', 'asset'],
    ['diagrams/flow.diagram.json', 'diagram'],
    ['diagrams/data-platform/processing/spark.diagram.json', 'diagram'],
  ])('allows %s as %s', (path, kind) => {
    expect(classifyPath(path)).toBe(kind);
  });

  it.each([
    // outside content/docs and public/docs
    'package.json',
    'content/other/a.mdx',
    'content/docs-old/a.mdx',
    'public/resume/index.html',
    'public/docs.png',
    // traversal and odd spellings
    '../package.json',
    'content/docs/../../package.json',
    'content/docs/./a.mdx',
    'content/docs//a.mdx',
    '/content/docs/a.mdx',
    'content\\notes\\a.mdx',
    'content/docs/a.mdx\0.png',
    '',
    // hidden paths
    'content/docs/.obsidian/app.json',
    'content/docs/.obsidian/a.mdx',
    'content/docs/.draft.mdx',
    'public/docs/.cache/a.png',
    // unknown extensions
    'content/docs/a.md',
    'content/docs/a.js',
    'content/docs/a.mdx.bak',
    'content/docs/other.yaml',
    'content/docs/other.json',
    'content/docs/meta.yml',
    'content/docs/a/meta.json.bak',
    'public/docs/a.js',
    'public/docs/a.exe',
    'public/docs/meta.yaml',
    'public/docs/meta.json',
    'diagrams/meta.json',
    // names of Object.prototype, which are not types
    'public/docs/a.constructor',
    'public/docs/a.__proto__',
    'public/docs/a.tostring',
    // diagrams: only *.diagram.json, not the schema or other files
    'diagrams/diagram.schema.json',
    'diagrams/README.md',
    'diagrams/a.json',
    'diagrams/a.diagram.json.bak',
    'diagrams/.diagram.json',
    'diagrams/.cache/a.diagram.json',
    'diagrams/../package.json',
    'diagrams-old/a.diagram.json',
    'content/docs/a.diagram.json',
  ])('rejects %j', (path) => {
    expect(classifyPath(path)).toBeNull();
  });
});

describe('isTextPath', () => {
  it('reads notes, meta files, SVG and HTML as text, other assets and other paths not', () => {
    for (const path of ['content/docs/a.mdx', 'content/docs/a/meta.yaml', 'content/docs/a/meta.json', 'public/docs/a/b.svg', 'public/docs/a/b.html', 'diagrams/a/b.diagram.json']) expect(isTextPath(path)).toBe(true);
    for (const path of ['public/docs/a/b.png', 'public/docs/a/b.pdf', 'package.json', 'content/docs/../x.mdx']) expect(isTextPath(path)).toBe(false);
  });
});

describe('resolveWorktreePath', () => {
  let worktree: Worktree;

  beforeAll(async () => {
    worktree = await makeWorktree();
    await mkdir(join(worktree.root, 'outside'));
    await writeFile(join(worktree.root, 'outside/secret.mdx'), 'secret');
    await symlink(join(worktree.root, 'outside/secret.mdx'), join(worktree.root, 'content/docs/link.mdx'));
    await symlink(join(worktree.root, 'outside'), join(worktree.root, 'content/docs/linked-dir'));
    await symlink(join(worktree.root, 'content/docs/index.mdx'), join(worktree.root, 'content/docs/inside-link.mdx'));
    await symlink(join(worktree.root, 'not-created-yet'), join(worktree.root, 'content/docs/dangling'));
    await mkdir(join(worktree.root, 'content/docs/folder.mdx'));
  });

  afterAll(async () => {
    await worktree.remove();
  });

  it('resolves an allowed path inside the worktree', () => {
    const resolved = resolveWorktreePath(worktree.root, 'content/docs/index.mdx');
    expect(resolved).toEqual({ kind: 'note', absolute: join(worktree.root, 'content/docs/index.mdx') });
  });

  it('resolves a file that does not exist yet', () => {
    const resolved = resolveWorktreePath(worktree.root, 'content/docs/new-folder/new.mdx');
    expect(resolved?.kind).toBe('note');
  });

  it('rejects symlinks that leave the allowed area', () => {
    expect(resolveWorktreePath(worktree.root, 'content/docs/link.mdx')).toBeNull();
    expect(resolveWorktreePath(worktree.root, 'content/docs/linked-dir/secret.mdx')).toBeNull();
    expect(resolveWorktreePath(worktree.root, 'content/docs/linked-dir/new.mdx')).toBeNull();
  });

  it('rejects symlinks that stay inside the area, since a save would replace the link', () => {
    expect(resolveWorktreePath(worktree.root, 'content/docs/inside-link.mdx')).toBeNull();
  });

  it('rejects a new file under a dangling symlinked folder', () => {
    expect(resolveWorktreePath(worktree.root, 'content/docs/dangling/new.mdx')).toBeNull();
  });

  it('rejects a folder named like a note', () => {
    expect(resolveWorktreePath(worktree.root, 'content/docs/folder.mdx')).toBeNull();
  });

  it('rejects paths the policy rejects', () => {
    expect(resolveWorktreePath(worktree.root, 'package.json')).toBeNull();
  });
});
