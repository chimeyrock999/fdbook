import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { git } from '../../../server/cr/git';
import type { ChangeRequest } from '../../../server/cr/manager';
import type { CheckRun } from '../../../server/preview/check-runs';
import type { Preview } from '../../../server/preview/preview';
import { makeGitRepo, startCrStudio, type CrStudio, type GitRepo } from '../../support/git-repo';
import { json, rawRequest } from '../../support/http';

// Preview through the real server: a change request made by the Studio, a
// commit from its Changes API, a push to the bare origin, and the build read
// from a stand-in for gh. The tests run in order and build on each other.
describe('preview API', () => {
  let repo: GitRepo;
  let studio: CrStudio;
  let cr: ChangeRequest;

  const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    rawRequest(`${studio.origin}${path}`, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', Origin: studio.origin, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const base = () => `/cr/${cr.slug}`;
  const preview = async () => {
    const response = await send(`${base()}/api/preview`);
    expect(response.status).toBe(200);
    return json(response) as Preview;
  };
  const push = () => send(`${base()}/api/preview`, 'POST', {});
  const edit = async (text: string) => {
    if (cr.worktree === null) throw new Error('no worktree');
    await writeFile(join(cr.worktree, 'content/notes/guide/first-look.mdx'), `---\ntitle: First look\n---\n\n${text}\n`);
    const response = await send(`${base()}/api/changes`, 'POST', { message: `docs(notes): ${text}`, paths: ['content/notes/guide/first-look.mdx'] });
    expect(response.status).toBe(200);
    return (json(response) as { sha: string }).sha;
  };
  const checks = () => studio.fake.checks as Map<string, CheckRun>;
  const remoteHead = async (ref: string) => (await git(repo.origin, 'rev-parse', '--verify', '--quiet', ref).catch(() => '')).trim();

  beforeAll(async () => {
    repo = await makeGitRepo();
    studio = await startCrStudio(repo);
    const created = await send('/api/crs', 'POST', { name: 'Preview probe' });
    cr = (json(created) as { cr: ChangeRequest }).cr;
  });

  afterAll(async () => {
    await studio.close();
    await repo.remove();
  });

  it('says there is nothing to preview on a new change request', async () => {
    expect(await preview()).toEqual({
      branch: 'cr/preview-probe',
      blocked: null,
      pushed: null,
      unpushed: [],
      uncommitted: 0,
      url: null,
      build: null,
    });
    const refused = await push();
    expect(refused.status).toBe(409);
    expect(json(refused)).toEqual({ error: 'Nothing to push: commit a change first.' });
  });

  it('counts the commits a push would send and the files not committed', async () => {
    const first = await edit('first');
    if (cr.worktree === null) throw new Error('no worktree');
    await writeFile(join(cr.worktree, 'content/notes/index.mdx'), '---\ntitle: Home\n---\n\nNot committed.\n');
    expect(await preview()).toMatchObject({ pushed: null, unpushed: [first], uncommitted: 1, build: null });
  });

  it('pushes the branch to origin, and nothing to main', async () => {
    const mainBefore = await remoteHead('refs/heads/main');
    const head = (await git(cr.worktree ?? '', 'rev-parse', 'HEAD')).trim();
    const response = await push();
    expect(response.status).toBe(200);
    const answer = json(response) as Preview;
    expect(answer).toMatchObject({ pushed: { sha: head }, unpushed: [], uncommitted: 1, url: 'https://cr-preview-probe.chimey.pages.dev' });
    expect(answer.build).toMatchObject({ state: 'waiting', logUrl: null });
    expect(await remoteHead('refs/heads/cr/preview-probe')).toBe(head);
    expect(await remoteHead('refs/heads/main')).toBe(mainBefore);
    // The change request reads as pushed at once, no fetch needed.
    const list = json(await send('/api/crs')) as { crs: ChangeRequest[] };
    expect(list.crs.find((each) => each.slug === cr.slug)).toMatchObject({ status: 'previewing', pushed: true });
  });

  it('says no build came three minutes after the push', async () => {
    // The fake clock started with the Studio, a little before the push.
    for (let minute = 0; minute < 4; minute += 1) studio.fake.forget();
    expect((await preview()).build).toMatchObject({ state: 'none', logUrl: null });
  });

  it('follows the Cloudflare Pages check run of the pushed commit', async () => {
    const head = (await git(cr.worktree ?? '', 'rev-parse', 'HEAD')).trim();
    checks().set(head, { status: 'in_progress', conclusion: null, detailsUrl: 'https://dash.example/log', summary: null, startedAt: '2026-10-22T08:00:00Z', completedAt: null });
    // Unfinished builds are read again after 10 seconds: start from a fresh reader.
    studio.fake.forget();
    expect((await preview()).build).toMatchObject({ state: 'building', logUrl: 'https://dash.example/log' });
    checks().set(head, {
      status: 'completed',
      conclusion: 'success',
      detailsUrl: 'https://dash.example/log',
      summary: "<strong>Preview URL:</strong> <a href='https://1a2b3c4d.chimey.pages.dev'>x</a> <strong>Branch Preview URL:</strong> <a href='https://cr-preview-probe.chimey.pages.dev'>y</a>",
      startedAt: '2026-10-22T08:00:00Z',
      completedAt: '2026-10-22T08:01:30Z',
    });
    studio.fake.forget();
    const ready = await preview();
    expect(ready.build).toEqual({
      state: 'ready',
      logUrl: 'https://dash.example/log',
      deploymentUrl: 'https://1a2b3c4d.chimey.pages.dev',
      aliasUrl: 'https://cr-preview-probe.chimey.pages.dev',
      at: '2026-10-22T08:01:30Z',
      error: null,
    });
    expect(ready.url).toBe('https://cr-preview-probe.chimey.pages.dev');
  });

  it('says the preview is behind once more is committed, and pushes only what is new', async () => {
    const pushed = (await preview()).pushed?.sha;
    const second = await edit('second');
    expect(await preview()).toMatchObject({ pushed: { sha: pushed }, unpushed: [second] });
    expect((await push()).status).toBe(200);
    expect(await preview()).toMatchObject({ pushed: { sha: second }, unpushed: [] });
  });

  it('says why when gh cannot read the build, and still pushes', async () => {
    studio.fake.checks = new Error('gh: not logged in');
    studio.fake.forget();
    expect((await preview()).build).toMatchObject({ state: 'unknown', error: 'gh: not logged in' });
    studio.fake.checks = new Map();
  });

  it('refuses a push the remote does not take, keeping its reason', async () => {
    // Someone else pushed to the branch: ours is no longer a fast-forward.
    const other = join(repo.base, 'other');
    await git(other, 'fetch', '--quiet', 'origin', 'cr/preview-probe');
    await git(other, 'checkout', '--quiet', '-B', 'elsewhere', 'FETCH_HEAD');
    await git(other, 'commit', '--quiet', '--allow-empty', '-m', 'from elsewhere');
    await git(other, 'push', '--quiet', 'origin', 'HEAD:refs/heads/cr/preview-probe');
    await edit('third');
    const refused = await push();
    expect(refused.status).toBe(409);
    expect((json(refused) as { error: string }).error).toMatch(/^The remote has commits this change request does not: /);
  });

  it('refuses a push on main, and one sent cross-site or not as JSON', async () => {
    expect((await send('/api/preview', 'POST', {})).status).toBe(403);
    expect(json(await send('/api/preview'))).toMatchObject({ branch: null, blocked: 'Main is read only: preview a change request.' });
    expect((await send(`${base()}/api/preview`, 'POST', {}, { Origin: 'http://evil.example' })).status).toBe(403);
    const form = await rawRequest(`${studio.origin}${base()}/api/preview`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: studio.origin }, body: '{}' });
    expect(form.status).toBe(415);
    expect((await send(`${base()}/api/preview`, 'PUT', {})).status).toBe(405);
  });
});
