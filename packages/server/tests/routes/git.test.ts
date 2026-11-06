import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { git } from '@fdbook/testing/git.ts';
import { json, rawRequest } from '#tests/support/http.ts';
import { startTestStudio, type TestStudio } from '@fdbook/testing/studio.ts';

type Changes = { branch: string | null; files: { path: string; status: string; from?: string }[] };
type Commit = { sha: string; date: string; message: string; files: { status: string; path: string }[] };
type History = { base: string | null; commits: Commit[] };

// The changes API on a git worktree copy of content/docs, through the real
// server. The tests run in order and build on each other's commits.
describe('changes API', () => {
  let studio: TestStudio;

  const changes = async () => json(await rawRequest(`${studio.url}api/changes`)) as Changes;
  const history = async () => json(await rawRequest(`${studio.url}api/changes/history`)) as History;
  const commit = (body: unknown, headers: Record<string, string> = {}) =>
    rawRequest(`${studio.url}api/changes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: studio.origin, ...headers },
      body: JSON.stringify(body),
    });
  const tree = (body: unknown) =>
    rawRequest(`${studio.url}api/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: studio.origin },
      body: JSON.stringify(body),
    });
  const note = (path: string) => join(studio.root, 'content/docs', path);
  const committed = (path: string) => git(studio.root, 'show', `HEAD:content/docs/${path}`);

  beforeAll(async () => {
    studio = await startTestStudio({ git: true });
  });
  afterAll(async () => {
    await studio.close();
  });

  it('starts clean, with no commits since main', async () => {
    expect(await changes()).toEqual({ branch: 'cr/test', files: [] });
    expect(await history()).toEqual({ base: 'origin/main', commits: [] });
  });

  it('lists a page created from the page tree with its meta.yaml', async () => {
    expect((await tree({ op: 'create', parent: 'diagrams', slug: 'sequence-diagrams', title: 'Sequence diagrams' })).status).toBe(200);
    expect((await changes()).files).toEqual([
      { path: 'content/docs/diagrams/meta.yaml', status: 'M' },
      { path: 'content/docs/diagrams/sequence-diagrams.mdx', status: 'A' },
    ]);
  });

  it('refuses an empty message, no files, a file that has no change and a cross-site post', async () => {
    const paths = ['content/docs/diagrams/sequence-diagrams.mdx'];
    const empty = await commit({ message: '  \n ', paths });
    expect(empty.status).toBe(400);
    expect(json(empty)).toEqual({ error: 'write a commit message' });
    expect((await commit({ message: 'x', paths: [] })).status).toBe(400);
    expect((await commit({ message: 'x', paths: 'content/docs/diagrams/meta.yaml' })).status).toBe(400);
    const stranger = await commit({ message: 'x', paths: ['content/docs/diagrams/index.mdx'] });
    expect(stranger.status).toBe(400);
    expect(json(stranger)).toEqual({ error: 'content/docs/diagrams/index.mdx has no change to commit' });
    expect((await commit({ message: 'x', paths: ['package.json'] })).status).toBe(400);
    expect((await commit({ message: 'x', paths }, { Origin: 'http://evil.example' })).status).toBe(403);
    const form = await rawRequest(`${studio.url}api/changes`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: studio.origin }, body: '{}' });
    expect(form.status).toBe(415);
    expect((await changes()).files).toHaveLength(2);
  });

  it('commits only the picked files and leaves the rest uncommitted, even when staged', async () => {
    git(studio.root, 'add', 'content/docs/diagrams/meta.yaml');
    const response = await commit({ message: '  docs(notes): add sequence-diagrams\n', paths: ['content/docs/diagrams/sequence-diagrams.mdx'] });
    expect(response.status).toBe(200);
    const made = json(response) as Commit;
    expect(made).toMatchObject({ message: 'docs(notes): add sequence-diagrams', files: [{ status: 'A', path: 'content/docs/diagrams/sequence-diagrams.mdx' }] });
    expect(made.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(studio.root, 'log', '-1', '--format=%s')).toBe('docs(notes): add sequence-diagrams\n');
    expect((await changes()).files).toEqual([{ path: 'content/docs/diagrams/meta.yaml', status: 'M' }]);
    // What was staged before stays staged, and nothing else is.
    expect(git(studio.root, 'diff', '--cached', '--name-only')).toBe('content/docs/diagrams/meta.yaml\n');
  });

  it('commits a deleted page and an edited one together', async () => {
    await rm(note('reference/lint.mdx'));
    const index = await readFile(note('diagrams/index.mdx'), 'utf8');
    await writeFile(note('diagrams/index.mdx'), `${index}\nMore.\n`);
    const response = await commit({
      message: 'docs(notes): update 2 pages',
      paths: ['content/docs/reference/lint.mdx', 'content/docs/diagrams/index.mdx', 'content/docs/diagrams/meta.yaml'],
    });
    expect(response.status).toBe(200);
    expect((json(response) as Commit).files).toEqual([
      { status: 'M', path: 'content/docs/diagrams/index.mdx' },
      { status: 'M', path: 'content/docs/diagrams/meta.yaml' },
      { status: 'D', path: 'content/docs/reference/lint.mdx' },
    ]);
    expect(committed('diagrams/index.mdx')).toBe(`${index}\nMore.\n`);
    expect((await changes()).files).toEqual([]);
  });

  it('commits a rename and a deletion staged in a terminal', async () => {
    git(studio.root, 'mv', 'content/docs/diagrams/examples.mdx', 'content/docs/diagrams/samples.mdx');
    await writeFile(note('diagrams/samples.mdx'), 'renamed and edited\n');
    git(studio.root, 'rm', '-q', 'content/docs/guide/setup.mdx');
    expect((await changes()).files).toEqual([
      { path: 'content/docs/diagrams/samples.mdx', status: 'R', from: 'content/docs/diagrams/examples.mdx' },
      { path: 'content/docs/guide/setup.mdx', status: 'D' },
    ]);
    const response = await commit({ message: 'docs(notes): rename and remove', paths: ['content/docs/diagrams/samples.mdx', 'content/docs/guide/setup.mdx'] });
    expect(response.status).toBe(200);
    expect((json(response) as Commit).files).toEqual([
      { status: 'D', path: 'content/docs/diagrams/examples.mdx' },
      { status: 'A', path: 'content/docs/diagrams/samples.mdx' },
      { status: 'D', path: 'content/docs/guide/setup.mdx' },
    ]);
    expect(committed('diagrams/samples.mdx')).toBe('renamed and edited\n');
    expect((await changes()).files).toEqual([]);
  });

  it('keeps a message that starts with #', async () => {
    await writeFile(note('diagrams/index.mdx'), 'issue\n');
    const response = await commit({ message: '#42 fix typo', paths: ['content/docs/diagrams/index.mdx'] });
    expect(response.status).toBe(200);
    expect((json(response) as Commit).message).toBe('#42 fix typo');
  });

  it('stages nothing when the commit fails', async () => {
    const hooks = join(studio.root, '.studio-test-hooks');
    await mkdir(hooks, { recursive: true });
    await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\necho "refused by the hook" >&2\nexit 1\n');
    await chmod(join(hooks, 'pre-commit'), 0o755);
    git(studio.root, 'config', 'core.hooksPath', hooks);
    await writeFile(note('diagrams/later.mdx'), '---\ntitle: Later\n---\n');
    const response = await commit({ message: 'docs(notes): add later', paths: ['content/docs/diagrams/later.mdx'] });
    expect(response.status).toBe(500);
    expect((json(response) as { error: string }).error).toContain('refused by the hook');
    expect(git(studio.root, 'diff', '--cached', '--name-only')).toBe('');
    expect((await changes()).files).toEqual([{ path: 'content/docs/diagrams/later.mdx', status: 'A' }]);
    git(studio.root, 'config', '--unset', 'core.hooksPath');
    await rm(hooks, { recursive: true });
    expect((await commit({ message: 'docs(notes): add later', paths: ['content/docs/diagrams/later.mdx'] })).status).toBe(200);
  });

  it('lists the change request commits, newest first, without merges', async () => {
    // main moves on, is fetched, and is merged into the change request.
    git(studio.root, 'switch', '--quiet', 'main');
    await writeFile(note('reference/architecture.mdx'), 'on main\n');
    git(studio.root, 'commit', '--quiet', '-am', 'main moves on');
    git(studio.root, 'update-ref', 'refs/remotes/origin/main', 'main');
    git(studio.root, 'switch', '--quiet', 'cr/test');
    git(studio.root, 'merge', '--quiet', '--no-ff', '-m', 'Merge main', 'main');
    expect(git(studio.root, 'log', '-1', '--format=%s')).toBe('Merge main\n');
    const { base, commits } = await history();
    expect(base).toBe('origin/main');
    expect(commits.map((each) => each.message)).toEqual(['docs(notes): add later', '#42 fix typo', 'docs(notes): rename and remove', 'docs(notes): update 2 pages', 'docs(notes): add sequence-diagrams']);
    expect(commits[4].files).toEqual([{ status: 'A', path: 'content/docs/diagrams/sequence-diagrams.mdx' }]);
    expect(Number.isNaN(Date.parse(commits[0].date))).toBe(false);
  });

  it('does not commit on main', async () => {
    git(studio.root, 'switch', '--quiet', 'main');
    await writeFile(note('diagrams/index.mdx'), 'on main\n');
    const response = await commit({ message: 'x', paths: ['content/docs/diagrams/index.mdx'] });
    expect(response.status).toBe(409);
    expect(json(response)).toEqual({ error: 'commit in a change request, not on main' });
    expect(git(studio.root, 'log', '-1', '--format=%s')).toBe('main moves on\n');
  });
});
