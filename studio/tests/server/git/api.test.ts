import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { git } from '../../support/git';
import { json, rawRequest } from '../../support/http';
import { startTestStudio, type TestStudio } from '../../support/studio';

type Changes = { branch: string | null; files: { path: string; status: string; from?: string }[] };
type Commit = { sha: string; date: string; message: string; files: { status: string; path: string }[] };
type History = { base: string | null; commits: Commit[] };

// The changes API on a git worktree copy of content/notes, through the real
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
  const note = (path: string) => join(studio.root, 'content/notes', path);
  const committed = (path: string) => git(studio.root, 'show', `HEAD:content/notes/${path}`);

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
    expect((await tree({ op: 'create', parent: 'streaming', slug: 'exactly-once-sinks', title: 'Exactly-once sinks' })).status).toBe(200);
    expect((await changes()).files).toEqual([
      { path: 'content/notes/streaming/exactly-once-sinks.mdx', status: 'A' },
      { path: 'content/notes/streaming/meta.yaml', status: 'M' },
    ]);
  });

  it('refuses an empty message, no files, a file that has no change and a cross-site post', async () => {
    const paths = ['content/notes/streaming/exactly-once-sinks.mdx'];
    const empty = await commit({ message: '  \n ', paths });
    expect(empty.status).toBe(400);
    expect(json(empty)).toEqual({ error: 'write a commit message' });
    expect((await commit({ message: 'x', paths: [] })).status).toBe(400);
    expect((await commit({ message: 'x', paths: 'content/notes/streaming/meta.yaml' })).status).toBe(400);
    const stranger = await commit({ message: 'x', paths: ['content/notes/streaming/index.mdx'] });
    expect(stranger.status).toBe(400);
    expect(json(stranger)).toEqual({ error: 'content/notes/streaming/index.mdx has no change to commit' });
    expect((await commit({ message: 'x', paths: ['package.json'] })).status).toBe(400);
    expect((await commit({ message: 'x', paths }, { Origin: 'http://evil.example' })).status).toBe(403);
    const form = await rawRequest(`${studio.url}api/changes`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: studio.origin }, body: '{}' });
    expect(form.status).toBe(415);
    expect((await changes()).files).toHaveLength(2);
  });

  it('commits only the picked files and leaves the rest uncommitted, even when staged', async () => {
    git(studio.root, 'add', 'content/notes/streaming/meta.yaml');
    const response = await commit({ message: '  docs(notes): add exactly-once-sinks\n', paths: ['content/notes/streaming/exactly-once-sinks.mdx'] });
    expect(response.status).toBe(200);
    const made = json(response) as Commit;
    expect(made).toMatchObject({ message: 'docs(notes): add exactly-once-sinks', files: [{ status: 'A', path: 'content/notes/streaming/exactly-once-sinks.mdx' }] });
    expect(made.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(studio.root, 'log', '-1', '--format=%s')).toBe('docs(notes): add exactly-once-sinks\n');
    expect((await changes()).files).toEqual([{ path: 'content/notes/streaming/meta.yaml', status: 'M' }]);
    // What was staged before stays staged, and nothing else is.
    expect(git(studio.root, 'diff', '--cached', '--name-only')).toBe('content/notes/streaming/meta.yaml\n');
  });

  it('commits a deleted page and an edited one together', async () => {
    await rm(note('distributed-systems/rpc-and-threads.mdx'));
    const index = await readFile(note('streaming/index.mdx'), 'utf8');
    await writeFile(note('streaming/index.mdx'), `${index}\nMore.\n`);
    const response = await commit({
      message: 'docs(notes): update 2 pages',
      paths: ['content/notes/distributed-systems/rpc-and-threads.mdx', 'content/notes/streaming/index.mdx', 'content/notes/streaming/meta.yaml'],
    });
    expect(response.status).toBe(200);
    expect((json(response) as Commit).files).toEqual([
      { status: 'D', path: 'content/notes/distributed-systems/rpc-and-threads.mdx' },
      { status: 'M', path: 'content/notes/streaming/index.mdx' },
      { status: 'M', path: 'content/notes/streaming/meta.yaml' },
    ]);
    expect(committed('streaming/index.mdx')).toBe(`${index}\nMore.\n`);
    expect((await changes()).files).toEqual([]);
  });

  it('commits a rename and a deletion staged in a terminal', async () => {
    git(studio.root, 'mv', 'content/notes/streaming/watermark-and-late-events.mdx', 'content/notes/streaming/watermarks.mdx');
    await writeFile(note('streaming/watermarks.mdx'), 'renamed and edited\n');
    git(studio.root, 'rm', '-q', 'content/notes/database/index.mdx');
    expect((await changes()).files).toEqual([
      { path: 'content/notes/database/index.mdx', status: 'D' },
      { path: 'content/notes/streaming/watermarks.mdx', status: 'R', from: 'content/notes/streaming/watermark-and-late-events.mdx' },
    ]);
    const response = await commit({ message: 'docs(notes): rename and remove', paths: ['content/notes/streaming/watermarks.mdx', 'content/notes/database/index.mdx'] });
    expect(response.status).toBe(200);
    expect((json(response) as Commit).files).toEqual([
      { status: 'D', path: 'content/notes/database/index.mdx' },
      { status: 'D', path: 'content/notes/streaming/watermark-and-late-events.mdx' },
      { status: 'A', path: 'content/notes/streaming/watermarks.mdx' },
    ]);
    expect(committed('streaming/watermarks.mdx')).toBe('renamed and edited\n');
    expect((await changes()).files).toEqual([]);
  });

  it('keeps a message that starts with #', async () => {
    await writeFile(note('streaming/index.mdx'), 'issue\n');
    const response = await commit({ message: '#42 fix typo', paths: ['content/notes/streaming/index.mdx'] });
    expect(response.status).toBe(200);
    expect((json(response) as Commit).message).toBe('#42 fix typo');
  });

  it('stages nothing when the commit fails', async () => {
    const hooks = join(studio.root, '.studio-test-hooks');
    await mkdir(hooks, { recursive: true });
    await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\necho "refused by the hook" >&2\nexit 1\n');
    await chmod(join(hooks, 'pre-commit'), 0o755);
    git(studio.root, 'config', 'core.hooksPath', hooks);
    await writeFile(note('streaming/later.mdx'), '---\ntitle: Later\n---\n');
    const response = await commit({ message: 'docs(notes): add later', paths: ['content/notes/streaming/later.mdx'] });
    expect(response.status).toBe(500);
    expect((json(response) as { error: string }).error).toContain('refused by the hook');
    expect(git(studio.root, 'diff', '--cached', '--name-only')).toBe('');
    expect((await changes()).files).toEqual([{ path: 'content/notes/streaming/later.mdx', status: 'A' }]);
    git(studio.root, 'config', '--unset', 'core.hooksPath');
    await rm(hooks, { recursive: true });
    expect((await commit({ message: 'docs(notes): add later', paths: ['content/notes/streaming/later.mdx'] })).status).toBe(200);
  });

  it('lists the change request commits, newest first, without merges', async () => {
    // main moves on, is fetched, and is merged into the change request.
    git(studio.root, 'switch', '--quiet', 'main');
    await writeFile(note('data-modeling/index.mdx'), 'on main\n');
    git(studio.root, 'commit', '--quiet', '-am', 'main moves on');
    git(studio.root, 'update-ref', 'refs/remotes/origin/main', 'main');
    git(studio.root, 'switch', '--quiet', 'cr/test');
    git(studio.root, 'merge', '--quiet', '--no-ff', '-m', 'Merge main', 'main');
    expect(git(studio.root, 'log', '-1', '--format=%s')).toBe('Merge main\n');
    const { base, commits } = await history();
    expect(base).toBe('origin/main');
    expect(commits.map((each) => each.message)).toEqual(['docs(notes): add later', '#42 fix typo', 'docs(notes): rename and remove', 'docs(notes): update 2 pages', 'docs(notes): add exactly-once-sinks']);
    expect(commits[4].files).toEqual([{ status: 'A', path: 'content/notes/streaming/exactly-once-sinks.mdx' }]);
    expect(Number.isNaN(Date.parse(commits[0].date))).toBe(false);
  });

  it('does not commit on main', async () => {
    git(studio.root, 'switch', '--quiet', 'main');
    await writeFile(note('streaming/index.mdx'), 'on main\n');
    const response = await commit({ message: 'x', paths: ['content/notes/streaming/index.mdx'] });
    expect(response.status).toBe(409);
    expect(json(response)).toEqual({ error: 'commit in a change request, not on main' });
    expect(git(studio.root, 'log', '-1', '--format=%s')).toBe('main moves on\n');
  });
});
