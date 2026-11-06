import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { git } from '#process/command.ts';
import type { ChangeRequest } from '#cr/manager.ts';
import type { Preview } from '#preview/preview.ts';
import type { PublishDraft } from '#preview/publish.ts';
import { makeGitRepo, startCrStudio, type CrStudio, type GitRepo } from '#tests/support/git-repo.ts';
import { json, rawRequest } from '#tests/support/http.ts';

// Publish through the real server: a change request made by the Studio,
// commits from its Changes API, the push to the bare origin, and the pull
// request from a stand-in for gh. The tests run in order and build on each other.
describe('publish API', () => {
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
  const preview = async () => json(await send(`${base()}/api/preview`)) as Preview;
  const draft = async () => {
    const response = await send(`${base()}/api/publish`);
    expect(response.status).toBe(200);
    return json(response) as PublishDraft;
  };
  const publish = (title: string, body: string) => send(`${base()}/api/publish`, 'POST', { title, body });
  const edit = async (text: string) => {
    if (cr.worktree === null) throw new Error('no worktree');
    await writeFile(join(cr.worktree, 'content/docs/guide/first-look.mdx'), `---\ntitle: First look\n---\n\n${text}\n`);
    const response = await send(`${base()}/api/changes`, 'POST', { message: `docs(notes): ${text}`, paths: ['content/docs/guide/first-look.mdx'] });
    expect(response.status).toBe(200);
    return (json(response) as { sha: string }).sha;
  };
  const remoteHead = async (ref: string) => (await git(repo.origin, 'rev-parse', '--verify', '--quiet', ref).catch(() => '')).trim();
  const branchPrs = () => {
    if (studio.fake.branchPrs instanceof Error) throw studio.fake.branchPrs;
    return studio.fake.branchPrs;
  };

  beforeAll(async () => {
    repo = await makeGitRepo();
    studio = await startCrStudio(repo);
    cr = (json(await send('/api/crs', 'POST', { name: 'Publish probe' })) as { cr: ChangeRequest }).cr;
  });

  afterAll(async () => {
    await studio.close();
    await repo.remove();
  });

  it('has no pull request and nothing to publish on a new change request', async () => {
    expect(await preview()).toMatchObject({ branch: 'cr/publish-probe', pr: null, prError: null });
    const refused = await publish('Publish probe', '');
    expect(refused.status).toBe(409);
    expect(json(refused)).toEqual({ error: 'Nothing to publish: commit a change first.' });
    expect(studio.fake.created).toEqual([]);
  });

  it("drafts the pull request from the change request's name and commits, oldest first", async () => {
    await edit('first');
    await edit('second');
    // Publish pushes, so the preview link is there before any Preview.
    expect(await draft()).toEqual({ title: 'Publish probe', body: '- docs(notes): first\n- docs(notes): second\n\nPreview: https://cr-publish-probe.chimey.pages.dev' });
  });

  it('pushes what is not pushed, then opens the pull request as edited', async () => {
    const mainBefore = await remoteHead('refs/heads/main');
    const head = (await git(cr.worktree ?? '', 'rev-parse', 'HEAD')).trim();
    const response = await publish('  Publish   probe, edited ', 'Edited body.\n\n- docs(notes): first');
    expect(response.status).toBe(200);
    const answer = json(response) as Preview;
    expect(answer).toMatchObject({ pushed: { sha: head }, unpushed: [], prError: null });
    expect(answer.pr).toEqual({ number: 101, url: 'https://github.com/o/r/pull/101', state: 'OPEN', title: 'Publish probe, edited' });
    expect(studio.fake.created).toEqual([{ branch: 'cr/publish-probe', title: 'Publish probe, edited', body: 'Edited body.\n\n- docs(notes): first' }]);
    expect(await remoteHead('refs/heads/cr/publish-probe')).toBe(head);
    expect(await remoteHead('refs/heads/main')).toBe(mainBefore);
  });

  it('reads the pull request fresh before publishing, so a second one is never opened', async () => {
    // Opened elsewhere (gh in a terminal) since the last read.
    const other = await makeGitRepo();
    const elsewhere = await startCrStudio(other);
    try {
      const probe = (json(await rawRequest(`${elsewhere.origin}/api/crs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: elsewhere.origin }, body: JSON.stringify({ name: 'Fresh probe' }) })) as { cr: ChangeRequest }).cr;
      const at = (path: string, method = 'GET', body?: unknown) =>
        rawRequest(`${elsewhere.origin}/cr/${probe.slug}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: elsewhere.origin }, body: body === undefined ? undefined : JSON.stringify(body) });
      await writeFile(join(probe.worktree ?? '', 'content/docs/index.mdx'), '---\ntitle: Home\n---\n\nFresh.\n');
      expect((await at('/api/changes', 'POST', { message: 'docs(notes): fresh', paths: ['content/docs/index.mdx'] })).status).toBe(200);
      expect(json(await at('/api/preview'))).toMatchObject({ pr: null });
      if (elsewhere.fake.branchPrs instanceof Error) throw elsewhere.fake.branchPrs;
      elsewhere.fake.branchPrs.set('cr/fresh-probe', { number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', title: 'Fresh probe' });
      const refused = await at('/api/publish', 'POST', { title: 'Fresh probe', body: '' });
      expect(json(refused)).toEqual({ error: 'Pull request #7 is open: push to it with Update PR.' });
      expect(elsewhere.fake.created).toEqual([]);
    } finally {
      await elsewhere.close();
      await other.remove();
    }
  });

  it('never opens a second pull request: later commits go to the open one', async () => {
    const third = await edit('third');
    const refused = await publish('Again', '');
    expect(refused.status).toBe(409);
    expect(json(refused)).toEqual({ error: 'Pull request #101 is open: push to it with Update PR.' });
    expect(await preview()).toMatchObject({ unpushed: [third], pr: { number: 101, state: 'OPEN' } });
    expect((await send(`${base()}/api/preview`, 'POST', {})).status).toBe(200);
    expect(await remoteHead('refs/heads/cr/publish-probe')).toBe(third);
    expect(studio.fake.created).toHaveLength(1);
  });

  it('reads a merged or closed pull request, and refuses to publish again', async () => {
    branchPrs().set('cr/publish-probe', { number: 101, url: 'https://github.com/o/r/pull/101', state: 'MERGED', title: 'Publish probe, edited' });
    studio.fake.forget();
    expect((await preview()).pr?.state).toBe('MERGED');
    await edit('after merge');
    const refused = await publish('Again', '');
    expect(refused.status).toBe(409);
    expect(json(refused)).toEqual({ error: 'Pull request #101 is merged. Clean up this change request from the list.' });
    branchPrs().set('cr/publish-probe', { number: 101, url: 'https://github.com/o/r/pull/101', state: 'CLOSED', title: 'x' });
    expect(json(await publish('Again', ''))).toEqual({ error: 'Pull request #101 is closed. Clean up this change request from the list.' });
    expect(studio.fake.created).toHaveLength(1);
  });

  it('refuses to publish when gh cannot read the pull request, and still previews', async () => {
    branchPrs().delete('cr/publish-probe');
    studio.fake.branchPrs = new Error('gh: not logged in');
    studio.fake.forget();
    expect(await preview()).toMatchObject({ pr: null, prError: 'gh: not logged in' });
    const refused = await publish('Again', '');
    expect(refused.status).toBe(502);
    expect(json(refused)).toEqual({ error: 'Could not read the pull request of cr/publish-probe: gh: not logged in' });
    expect((await send(`${base()}/api/preview`, 'POST', {})).status).toBe(200);
  });

  it('keeps the push when gh cannot open the pull request, and says so', async () => {
    studio.fake.branchPrs = new Map();
    studio.fake.createError = new Error('GraphQL: Resource not accessible by integration (createPullRequest)');
    const head = await edit('gh refuses');
    const refused = await publish('Publish probe', '');
    expect(refused.status).toBe(502);
    expect(json(refused)).toEqual({
      error: 'Could not open the pull request: GraphQL: Resource not accessible by integration (createPullRequest) The branch is pushed; try again.',
    });
    expect(await remoteHead('refs/heads/cr/publish-probe')).toBe(head);
    studio.fake.createError = null;
    expect((await publish('Publish probe', '')).status).toBe(200);
    expect(studio.fake.created).toHaveLength(2);
  });

  it('wants a title, and strings', async () => {
    expect(json(await publish('  ', 'x'))).toEqual({ error: 'Give the pull request a title.' });
    expect((await send(`${base()}/api/publish`, 'POST', { title: 1, body: '' })).status).toBe(400);
    expect(json(await publish('x'.repeat(257), ''))).toEqual({ error: 'The title is longer than 256 characters.' });
  });

  it('refuses on main, and a publish sent cross-site or not as JSON', async () => {
    expect((await send('/api/publish', 'POST', { title: 'x', body: '' })).status).toBe(403);
    expect(json(await send('/api/publish'))).toEqual({ error: 'Main is read only: preview a change request.' });
    expect((await send(`${base()}/api/publish`, 'POST', { title: 'x', body: '' }, { Origin: 'http://evil.example' })).status).toBe(403);
    const form = await rawRequest(`${studio.origin}${base()}/api/publish`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: studio.origin }, body: '{}' });
    expect(form.status).toBe(415);
    expect((await send(`${base()}/api/publish`, 'PUT', {})).status).toBe(405);
  });
});
