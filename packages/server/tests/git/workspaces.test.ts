import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { git } from '#cr/git.ts';
import type { ChangeRequest } from '#cr/manager.ts';
import { makeGitRepo, startCrStudio, type CrStudio, type GitRepo } from '#tests/support/git-repo.ts';
import { json, rawRequest } from '#tests/support/http.ts';

type Changes = { branch: string | null; files: { path: string; status: string }[] };
type History = { base: string | null; commits: { message: string; files: { status: string; path: string }[] }[] };

const PAGE = 'content/docs/guide/first-look.mdx';

// The changes API with change requests: each worktree answers at its own
// URL, main (read only) refuses a commit, and a commit lands in the change
// request its URL names, and nowhere else.
describe('changes API per change request', () => {
  let repo: GitRepo;
  let studio: CrStudio;
  let one: ChangeRequest;
  let two: ChangeRequest;

  const send = (path: string, method = 'GET', body?: unknown) =>
    rawRequest(`${studio.origin}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', Origin: studio.origin },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const create = async (name: string) => (json(await send('/api/crs', 'POST', { name })) as { cr: ChangeRequest }).cr;
  const changes = async (base: string) => json(await send(`${base}/api/changes`)) as Changes;
  const history = async (base: string) => json(await send(`${base}/api/changes/history`)) as History;

  beforeAll(async () => {
    repo = await makeGitRepo();
    studio = await startCrStudio(repo);
    one = await create('One');
    two = await create('Two');
  });

  afterAll(async () => {
    await studio.close();
    await repo.remove();
  });

  it('lists nothing to commit on main, and refuses a commit there', async () => {
    expect(await changes('')).toEqual({ branch: null, files: [] });
    const main = join(await realpath(join(repo.home, 'worktrees')), '_main');
    // Even with a change on disk, main takes no commit.
    await writeFile(join(main, PAGE), 'changed on main\n');
    expect((await changes('')).files).toEqual([{ path: PAGE, status: 'M' }]);
    const refused = await send('/api/changes', 'POST', { message: 'x', paths: [PAGE] });
    expect(refused.status).toBe(403);
    expect(json(refused)).toEqual({ error: 'main is read only: edit in a change request' });
    expect((await git(main, 'status', '--porcelain')).trim()).toBe(`M ${PAGE}`);
    await git(main, 'checkout', '--', PAGE);
  });

  it('commits in the change request its URL names, under its own lock, and nowhere else', async () => {
    const base = `/cr/${one.slug}`;
    await writeFile(join(one.worktree ?? '', PAGE), 'edited in one\n');
    expect(await changes(base)).toEqual({ branch: one.branch, files: [{ path: PAGE, status: 'M' }] });
    expect((await changes(`/cr/${two.slug}`)).files).toEqual([]);
    const response = await send(`${base}/api/changes`, 'POST', { message: 'docs(notes): update first-look', paths: [PAGE] });
    expect(response.status).toBe(200);
    expect((await git(one.worktree ?? '', 'log', '-1', '--format=%s')).trim()).toBe('docs(notes): update first-look');
    expect((await git(two.worktree ?? '', 'log', '-1', '--format=%s')).trim()).toBe('notes');
    expect(await readFile(join(two.worktree ?? '', PAGE), 'utf8')).toBe('---\ntitle: First look\n---\n\nA first look.\n');
    expect((await history(base)).commits.map((commit) => commit.message)).toEqual(['docs(notes): update first-look']);
    expect(await history(`/cr/${two.slug}`)).toEqual({ base: 'origin/main', commits: [] });
    expect(await history('')).toEqual({ base: 'origin/main', commits: [] });
  });
  it('reads a page history on main and in a change request, and restores only in one', async () => {
    type Versions = { mtimeMs: number; versions: { sha: string; message: string; inChangeRequest: boolean }[] };
    const historyOf = async (base: string) => json(await send(`${base}/api/history?path=${encodeURIComponent(PAGE)}`)) as Versions;
    const onMain = await historyOf('');
    expect(onMain.versions.map(({ message, inChangeRequest }) => ({ message, inChangeRequest }))).toEqual([{ message: 'notes', inChangeRequest: false }]);
    const inOne = await historyOf(`/cr/${one.slug}`);
    expect(inOne.versions.map(({ message, inChangeRequest }) => ({ message, inChangeRequest }))).toEqual([
      { message: 'docs(notes): update first-look', inChangeRequest: true },
      { message: 'notes', inChangeRequest: false },
    ]);
    const oldest = onMain.versions[0].sha;
    expect((await send('/api/history/restore', 'POST', { path: PAGE, sha: oldest, mtimeMs: onMain.mtimeMs })).status).toBe(403);
    const restored = await send(`/cr/${one.slug}/api/history/restore`, 'POST', { path: PAGE, sha: oldest, mtimeMs: inOne.mtimeMs });
    expect(restored.status).toBe(200);
    expect(await readFile(join(one.worktree ?? '', PAGE), 'utf8')).toBe('---\ntitle: First look\n---\n\nA first look.\n');
    expect((await changes(`/cr/${one.slug}`)).files).toEqual([{ path: PAGE, status: 'M' }]);
  });
});
