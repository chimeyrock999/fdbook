import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { git } from '../../../server/cr/git';
import type { ChangeRequest, Discard } from '../../../server/cr/manager';
import { makeGitRepo, startCrStudio, type CrStudio, type GitRepo } from '../../support/git-repo';
import { json, rawRequest } from '../../support/http';

type List = { enabled: boolean; crs: ChangeRequest[]; taken: string[]; prError: string | null; fetchError: string | null };

const DAY_MS = 24 * 3600_000;
const FIRST_LOOK = 'content/notes/guide/first-look.mdx';

// Stale, drift from main, and discarding what is on origin too (#21).
describe('cleaning up change requests', () => {
  let repo: GitRepo;
  let studio: CrStudio;

  const send = (path: string, method = 'GET', body?: unknown) =>
    rawRequest(`${studio.origin}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', Origin: studio.origin },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const list = async (fresh = false) => json(await send(`/api/crs${fresh ? '?fresh=1' : ''}`)) as List;
  const find = async (slug: string, fresh = false) => (await list(fresh)).crs.find((each) => each.slug === slug);
  const create = async (name: string) => {
    const response = await send('/api/crs', 'POST', { name });
    expect(response.status).toBe(200);
    return (json(response) as { cr: ChangeRequest }).cr;
  };
  const discard = async (slug: string, dryRun = false) => {
    const response = await send(`/api/crs/${slug}/discard`, 'POST', { dryRun });
    return { status: response.status, body: json(response) as { discard: Discard; error?: string } };
  };
  // Commits `content` to `path` in the change request's worktree.
  const commit = async (cr: ChangeRequest, path: string, content: string, message = 'edit') => {
    await writeFile(join(cr.worktree ?? '', path), content);
    await git(cr.worktree ?? '', 'add', '-A');
    await git(cr.worktree ?? '', 'commit', '--quiet', '-m', message);
  };
  const push = (cr: ChangeRequest) => git(cr.worktree ?? '', 'push', '--quiet', 'origin', `${cr.branch}:${cr.branch}`);
  const onOrigin = async (branch: string) => (await git(repo.origin, 'for-each-ref', '--format=%(refname)', `refs/heads/${branch}`)).trim() !== '';

  beforeAll(async () => {
    repo = await makeGitRepo();
    studio = await startCrStudio(repo);
  });

  afterAll(async () => {
    await studio.close();
    await repo.remove();
  });

  describe('drift from main', () => {
    let clash: ChangeRequest;
    let apart: ChangeRequest;

    beforeAll(async () => {
      clash = await create('Clash');
      apart = await create('Apart');
      await commit(clash, FIRST_LOOK, '---\ntitle: First look\n---\n\nThe change request says this.\n');
      await commit(apart, 'content/notes/guide/apart.mdx', '---\ntitle: Apart\n---\n');
    });

    it('is up to date with the main it branched from', async () => {
      expect((await find(clash.slug))?.drift).toEqual({ behind: 0, conflicts: [] });
    });

    it('sees main move only after a refresh fetches origin', async () => {
      await repo.pushToMain({ [FIRST_LOOK]: '---\ntitle: First look\n---\n\nMain says that.\n' });
      expect((await find(clash.slug))?.drift).toEqual({ behind: 0, conflicts: [] });
      const fresh = await list(true);
      expect(fresh.fetchError).toBeNull();
      expect(fresh.crs.find((each) => each.slug === clash.slug)?.drift).toEqual({ behind: 1, conflicts: [FIRST_LOOK] });
    });

    it('lists no conflicts when the change request touches other files', async () => {
      expect((await find(apart.slug))?.drift).toEqual({ behind: 1, conflicts: [] });
    });

    it('leaves the worktree as it was', async () => {
      expect((await git(clash.worktree ?? '', 'status', '--porcelain')).trim()).toBe('');
      expect((await git(clash.worktree ?? '', 'rev-list', '--count', 'origin/main..HEAD')).trim()).toBe('1');
    });

    it('lists a conflicting path with non-ASCII characters as it is', async () => {
      const path = 'content/notes/guide/ghi-chú.mdx';
      await repo.pushToMain({ [path]: 'main\n' });
      const viet = await create('Ghi chu');
      await repo.pushToMain({ [path]: 'main again\n' });
      await commit(viet, path, 'the change request\n');
      expect((await find(viet.slug, true))?.drift).toEqual({ behind: 1, conflicts: [path] });
      await discard(viet.slug);
    });

    it('reads as unknown, not as an error, when it cannot be read', async () => {
      const odd = await create('Unrelated');
      const tree = (await git(odd.worktree ?? '', 'write-tree')).trim();
      const orphan = (await git(odd.worktree ?? '', 'commit-tree', '-m', 'orphan', tree)).trim();
      await git(odd.worktree ?? '', 'reset', '--quiet', '--hard', orphan);
      const answer = await list();
      expect(answer.crs.find((each) => each.slug === odd.slug)?.drift).toBeNull();
      expect(answer.crs.find((each) => each.slug === clash.slug)?.drift?.behind).toBeGreaterThan(0);
      await discard(odd.slug);
    });

    it('is not read for a merged change request', async () => {
      await push(apart);
      studio.fake.prs = [{ number: 5, url: 'https://github.com/o/r/pull/5', state: 'MERGED', headRefName: apart.branch }];
      expect((await find(apart.slug, true))?.drift).toBeNull();
      studio.fake.prs = [];
    });

    it('says why the fetch failed and lists from the refs it has', async () => {
      await git(repo.repo, 'remote', 'set-url', 'origin', join(repo.base, 'nowhere.git'));
      try {
        const answer = await list(true);
        expect(answer.fetchError).toMatch(/nowhere/);
        expect(answer.crs.find((each) => each.slug === clash.slug)?.drift).toMatchObject({ conflicts: [FIRST_LOOK] });
      } finally {
        await git(repo.repo, 'remote', 'set-url', 'origin', repo.origin);
      }
    });

    afterAll(async () => {
      for (const cr of [clash, apart]) await discard(cr.slug);
    });
  });

  describe('stale', () => {
    it('marks an open change request not touched for 30 days, and only that', async () => {
      const old = await create('Old one');
      const fresh = await create('Fresh one');
      await git(repo.repo, 'config', `branch.${old.branch}.studiocreated`, String(Date.now() - 31 * DAY_MS));
      expect(await find(old.slug)).toMatchObject({ stale: true, status: 'draft' });
      expect(await find(fresh.slug)).toMatchObject({ stale: false });

      // Merged: to clean up, not stale.
      await push(old);
      studio.fake.prs = [{ number: 9, url: 'https://github.com/o/r/pull/9', state: 'MERGED', headRefName: old.branch }];
      expect(await find(old.slug, true)).toMatchObject({ stale: false, status: 'merged' });
      studio.fake.prs = [{ number: 9, url: 'https://github.com/o/r/pull/9', state: 'OPEN', headRefName: old.branch }];
      expect(await find(old.slug, true)).toMatchObject({ stale: true, status: 'review' });
      studio.fake.prs = [];
      for (const cr of [old, fresh]) await discard(cr.slug);
    });

    it('reads the last commit of a change request whose worktree is gone', async () => {
      const cr = await create('No worktree');
      await git(repo.repo, 'config', `branch.${cr.branch}.studiocreated`, String(Date.now() - 60 * DAY_MS));
      const when = String(Math.floor((Date.now() - 2 * DAY_MS) / 1000));
      await writeFile(join(cr.worktree ?? '', FIRST_LOOK), 'two days ago\n');
      execFileSync('git', ['commit', '--quiet', '-am', 'old'], { cwd: cr.worktree ?? '', env: { ...process.env, GIT_COMMITTER_DATE: `${when} +0000`, GIT_AUTHOR_DATE: `${when} +0000` } });
      await rm(cr.worktree ?? '', { recursive: true, force: true });
      const found = await find(cr.slug);
      expect(found).toMatchObject({ worktree: null, stale: false });
      expect(found?.updatedMs).toBe(Number(when) * 1000);
      await discard(cr.slug);
    });

    it('follows STUDIO_STALE_DAYS', async () => {
      await studio.close();
      studio = await startCrStudio(repo, { staleDays: 2 });
      const cr = await create('Three days');
      await git(repo.repo, 'config', `branch.${cr.branch}.studiocreated`, String(Date.now() - 3 * DAY_MS));
      expect(await find(cr.slug)).toMatchObject({ stale: true });
      await discard(cr.slug);
      await studio.close();
      studio = await startCrStudio(repo);
    });
  });

  describe('discarding', () => {
    it('leaves origin alone for a draft', async () => {
      const cr = await create('Local only');
      const { body } = await discard(cr.slug, true);
      expect(body.discard).toMatchObject({ pushed: false, closesPr: null, unpushed: 0, status: 'draft' });
      expect((await discard(cr.slug)).status).toBe(200);
      expect(studio.fake.closed).toEqual([]);
      expect(existsSync(cr.worktree ?? '')).toBe(false);
    });

    it('closes the open pull request and deletes the branch on origin, then the local one', async () => {
      const cr = await create('Pushed and open');
      await commit(cr, FIRST_LOOK, 'pushed\n');
      await push(cr);
      await commit(cr, FIRST_LOOK, 'not pushed\n', 'later');
      studio.fake.prs = [{ number: 12, url: 'https://github.com/o/r/pull/12', state: 'OPEN', headRefName: cr.branch }];
      await list(true);
      const dry = (await discard(cr.slug, true)).body.discard;
      expect(dry).toMatchObject({ pushed: true, closesPr: { number: 12, url: 'https://github.com/o/r/pull/12' }, commits: 2, unpushed: 1, status: 'review' });
      expect(await onOrigin(cr.branch)).toBe(true);

      expect((await discard(cr.slug)).status).toBe(200);
      expect(studio.fake.closed).toEqual([12]);
      expect(await onOrigin(cr.branch)).toBe(false);
      await expect(git(repo.repo, 'rev-parse', '--verify', `refs/remotes/origin/${cr.branch}`)).rejects.toThrow();
      await expect(git(repo.repo, 'rev-parse', '--verify', cr.branch)).rejects.toThrow();
      expect(existsSync(cr.worktree ?? '')).toBe(false);
      studio.fake.prs = [];
      studio.fake.closed = [];
    });

    it('reads the pull request again, not the list\'s cached one', async () => {
      const cr = await create('Opened since');
      await push(cr);
      await list(true);
      // Opened on GitHub after the list read the pull requests.
      studio.fake.prs = [{ number: 16, url: 'https://github.com/o/r/pull/16', state: 'OPEN', headRefName: cr.branch }];
      expect((await discard(cr.slug, true)).body.discard).toMatchObject({ status: 'review', closesPr: { number: 16 } });
      expect((await discard(cr.slug)).status).toBe(200);
      expect(studio.fake.closed).toEqual([16]);
      studio.fake.prs = [];
      studio.fake.closed = [];
    });

    it('refuses when origin changed since the dry run the user confirmed', async () => {
      const cr = await create('Pushed meanwhile');
      const seen = (await discard(cr.slug, true)).body.discard;
      expect(seen.pushed).toBe(false);
      await push(cr);
      const response = await send(`/api/crs/${cr.slug}/discard`, 'POST', { seen: { pushed: seen.pushed, closesPr: null } });
      expect(response.status).toBe(409);
      expect(await onOrigin(cr.branch)).toBe(true);
      expect(existsSync(cr.worktree ?? '')).toBe(true);
      expect((await send(`/api/crs/${cr.slug}/discard`, 'POST', { seen: { pushed: true, closesPr: null } })).status).toBe(200);
      expect(await onOrigin(cr.branch)).toBe(false);
      expect((await send(`/api/crs/x/discard`, 'POST', { seen: { pushed: 'yes' } })).status).toBe(400);
    });

    it('says the pull request was closed when the branch then cannot be deleted', async () => {
      const cr = await create('Half done');
      await push(cr);
      studio.fake.prs = [{ number: 17, url: 'https://github.com/o/r/pull/17', state: 'OPEN', headRefName: cr.branch }];
      await git(repo.repo, 'remote', 'set-url', '--push', 'origin', join(repo.base, 'nowhere.git'));
      try {
        const { status, body } = await discard(cr.slug);
        expect(status).toBe(502);
        expect(body.error).toMatch(/^Pull request #17 was closed, but the branch on origin could not be deleted: .* Nothing was removed from this machine\.$/s);
        expect(existsSync(cr.worktree ?? '')).toBe(true);
      } finally {
        await git(repo.repo, 'remote', 'set-url', '--delete', '--push', 'origin', '.*');
      }
      studio.fake.prs = [];
      studio.fake.closed = [];
      await discard(cr.slug);
    });

    it('cleans up a merged change request whose branch GitHub already deleted', async () => {
      const cr = await create('Merged elsewhere');
      await commit(cr, FIRST_LOOK, 'merged\n');
      await push(cr);
      studio.fake.prs = [{ number: 13, url: 'https://github.com/o/r/pull/13', state: 'MERGED', headRefName: cr.branch }];
      await list(true);
      await git(repo.origin, 'update-ref', '-d', `refs/heads/${cr.branch}`);
      // The dry run fetches first: nothing left on origin.
      expect((await discard(cr.slug, true)).body.discard).toMatchObject({ pushed: false, closesPr: null, status: 'merged' });
      expect((await discard(cr.slug)).status).toBe(200);
      expect(studio.fake.closed).toEqual([]);
      expect(existsSync(cr.worktree ?? '')).toBe(false);
      studio.fake.prs = [];
    });

    it('deletes the remote branch of a merged change request it still has', async () => {
      const cr = await create('Merged, branch kept');
      await commit(cr, FIRST_LOOK, 'previewed\n');
      // Pushed the way the Studio does it, with Preview.
      expect((await send(`/cr/${cr.slug}/api/preview`, 'POST', {})).status).toBe(200);
      expect(await onOrigin(cr.branch)).toBe(true);
      studio.fake.prs = [{ number: 14, url: 'https://github.com/o/r/pull/14', state: 'MERGED', headRefName: cr.branch }];
      await list(true);
      expect((await discard(cr.slug, true)).body.discard).toMatchObject({ pushed: true, closesPr: null });
      expect((await discard(cr.slug)).status).toBe(200);
      expect(await onOrigin(cr.branch)).toBe(false);
      studio.fake.prs = [];
    });

    it('removes nothing when origin refuses', async () => {
      const cr = await create('Origin refuses');
      await push(cr);
      await git(repo.repo, 'remote', 'set-url', '--push', 'origin', join(repo.base, 'nowhere.git'));
      try {
        const { status, body } = await discard(cr.slug);
        expect(status).toBe(502);
        expect(body.error).toMatch(/Nothing was removed/);
        expect(existsSync(cr.worktree ?? '')).toBe(true);
        expect((await git(repo.repo, 'rev-parse', '--verify', cr.branch)).trim()).not.toBe('');
      } finally {
        await git(repo.repo, 'remote', 'set-url', '--delete', '--push', 'origin', '.*');
      }
      expect((await discard(cr.slug)).status).toBe(200);
      expect(await onOrigin(cr.branch)).toBe(false);
    });

    it('removes nothing when the pull request cannot be closed', async () => {
      const cr = await create('Gh refuses');
      await push(cr);
      studio.fake.prs = [{ number: 15, url: 'https://github.com/o/r/pull/15', state: 'OPEN', headRefName: cr.branch }];
      studio.fake.closeError = new Error('gh: not logged in');
      await list(true);
      const { status, body } = await discard(cr.slug);
      expect(status).toBe(502);
      expect(body.error).toMatch(/gh: not logged in/);
      expect(await onOrigin(cr.branch)).toBe(true);
      expect(existsSync(cr.worktree ?? '')).toBe(true);
      studio.fake.closeError = null;
      expect((await discard(cr.slug)).status).toBe(200);
      expect(studio.fake.closed).toEqual([15]);
      studio.fake.prs = [];
      studio.fake.closed = [];
    });
  });
});
