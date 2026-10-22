import { existsSync } from 'node:fs';
import { readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSyncClient, SYNC_ENDPOINT, wsTransport, type DocumentEditor } from '@fumadocs-editor/core/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { git } from '../../../server/cr/git';
import type { ChangeRequest, Discard } from '../../../server/cr/manager';
import { makeGitRepo, startCrStudio, type CrStudio, type GitRepo } from '../../support/git-repo';
import { json, rawRequest, tryUpgrade } from '../../support/http';

type List = { enabled: boolean; crs: ChangeRequest[]; taken: string[]; prError: string | null; fetchError: string | null };

class TextEditor implements DocumentEditor {
  text = '';
  getMarkdown() {
    return this.text;
  }
  applyExternalMarkdown(text: string) {
    this.text = text;
    return Promise.resolve([]);
  }
  setMarkdown(text: string) {
    this.text = text;
    return Promise.resolve();
  }
  markSaved() {
    // keeps no base
  }
}

describe('change requests', () => {
  let repo: GitRepo;
  let studio: CrStudio;

  const send = (path: string, method = 'GET', body?: unknown) =>
    rawRequest(`${studio.origin}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', Origin: studio.origin },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const list = async (fresh = false) => json(await send(`/api/crs${fresh ? '?fresh=1' : ''}`)) as List;
  const create = async (name: string) => {
    const response = await send('/api/crs', 'POST', { name });
    expect(response.status).toBe(200);
    return (json(response) as { cr: ChangeRequest }).cr;
  };
  const putNote = (base: string, path: string, content: string, baseMtime: number | null) =>
    send(`${base}/api/file?path=${encodeURIComponent(path)}`, 'PUT', { content, baseMtime });
  const readNote = async (base: string, path: string) =>
    json(await send(`${base}/api/file?path=${encodeURIComponent(path)}`)) as { content: string; mtimeMs: number };
  const worktrees = async () => realpath(join(repo.home, 'worktrees'));

  beforeAll(async () => {
    repo = await makeGitRepo();
    studio = await startCrStudio(repo);
  });

  afterAll(async () => {
    await studio.close();
    await repo.remove();
  });

  describe('reading main', () => {
    it('opens a worktree of origin/main outside the repo', async () => {
      const main = join(await worktrees(), '_main');
      expect((await git(main, 'rev-parse', 'HEAD')).trim()).toBe((await git(repo.repo, 'rev-parse', 'origin/main')).trim());
      expect((await readNote('', 'content/notes/index.mdx')).content).toBe(await readFile(join(main, 'content/notes/index.mdx'), 'utf8'));
      expect(await list()).toEqual({ enabled: true, crs: [], taken: [], prError: null, fetchError: null });
    });

    it('refuses every write to main', async () => {
      const { mtimeMs } = await readNote('', 'content/notes/index.mdx');
      expect((await putNote('', 'content/notes/index.mdx', 'changed\n', mtimeMs)).status).toBe(403);
      expect((await send('/api/tree', 'POST', { op: 'rename', path: 'guide/first-look.mdx', slug: 'x', dryRun: true })).status).toBe(403);
      expect((await send('/api/assets', 'POST', { op: 'delete', path: 'public/notes/x.png', baseMtime: 0, dryRun: true })).status).toBe(403);
      const lint = await send('/api/lint', 'POST', { path: 'content/notes/index.mdx', content: '# Hi\n' });
      expect(lint.status).toBe(200);
      expect((await readNote('', 'content/notes/index.mdx')).content).toBe('---\ntitle: Home\n---\n\nWelcome.\n');
    });

    it('opens notes on main read only through the sync', async () => {
      const client = createSyncClient({ transport: wsTransport(`ws://127.0.0.1:${studio.port}${SYNC_ENDPOINT}`) });
      try {
        const opened = await client.open('index.mdx', { editor: new TextEditor() }).opened;
        expect(opened.writable).toBe(false);
      } finally {
        client.close();
      }
    });
  });

  describe('creating', () => {
    let cr: ChangeRequest;
    let mainTip: string;

    beforeAll(async () => {
      mainTip = await repo.pushToMain({ 'content/notes/guide/second.mdx': '---\ntitle: Second\n---\n' });
      cr = await create('Sửa Driver container notes cho Databricks');
    });

    it('branches cr/<slug> from origin/main as just fetched, into a worktree in the Studio home', async () => {
      expect(cr).toMatchObject({ slug: 'sua-driver-container-not', branch: 'cr/sua-driver-container-not', name: 'Sửa Driver container notes cho Databricks', status: 'draft', pushed: false });
      expect(cr.worktree).toBe(join(await worktrees(), cr.slug));
      expect((await git(repo.repo, 'rev-parse', cr.branch)).trim()).toBe(mainTip);
      expect((await git(cr.worktree ?? '', 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe(cr.branch);
      // Reading main follows the same fetch.
      expect((await git(join(await worktrees(), '_main'), 'rev-parse', 'HEAD')).trim()).toBe(mainTip);
    });

    it('does not track main, so a push cannot land there', async () => {
      await expect(git(repo.repo, 'config', `branch.${cr.branch}.merge`)).rejects.toThrow();
    });

    it('gives the same name a new slug', async () => {
      const again = await create('Sửa Driver container notes cho Databricks');
      expect(again.slug).toBe('sua-driver-container-n-2');
      await send(`/api/crs/${again.slug}/discard`, 'POST', {});
    });

    it('does not take the slug of a branch someone else pushed, fetching origin itself', async () => {
      await git(repo.repo, 'push', '--quiet', 'origin', 'origin/main:refs/heads/cr/fix-typo');
      // As if pushed from another machine: this clone has not fetched it.
      await git(repo.repo, 'update-ref', '-d', 'refs/remotes/origin/cr/fix-typo');
      const mine = await create('Fix typo');
      expect(mine.slug).toBe('fix-typo-2');
      expect((await list()).taken).toContain('fix-typo');
      await send(`/api/crs/${mine.slug}/discard`, 'POST', {});
    });

    it('does not take the slug of a past pull request, whose status it would show', async () => {
      studio.fake.prs = [{ number: 7, url: 'https://github.com/o/r/pull/7', state: 'MERGED', headRefName: 'cr/old-work' }];
      expect((await list(true)).taken).toContain('old-work');
      const again = await create('Old work');
      expect(again).toMatchObject({ slug: 'old-work-2', status: 'draft', pr: null });
      studio.fake.prs = [];
      await send(`/api/crs/${again.slug}/discard`, 'POST', {});
    });

    it('refuses a name without letters or digits, and an empty one', async () => {
      for (const name of ['  ', '!!!', 42]) expect((await send('/api/crs', 'POST', { name })).status).toBe(400);
    });

    it('writes through /cr/<slug>/ into its worktree only', async () => {
      const base = `/cr/${cr.slug}`;
      const path = 'content/notes/guide/first-look.mdx';
      const { mtimeMs } = await readNote(base, path);
      expect((await putNote(base, path, 'edited in the change request\n', mtimeMs)).status).toBe(200);
      expect(await readFile(join(cr.worktree ?? '', path), 'utf8')).toBe('edited in the change request\n');
      expect((await readNote('', path)).content).toBe('---\ntitle: First look\n---\n\nA first look.\n');
      expect(await readFile(join(repo.repo, path), 'utf8')).toBe('---\ntitle: First look\n---\n\nA first look.\n');
      const tree = json(await send(`${base}/api/tree`)) as { tree: { children: unknown[] } };
      expect(tree.tree.children.length).toBeGreaterThan(0);
    });

    it('opens the change request writable through its sync', async () => {
      const client = createSyncClient({ transport: wsTransport(`ws://127.0.0.1:${studio.port}/cr/${cr.slug}${SYNC_ENDPOINT}`) });
      try {
        const opened = await client.open('guide/first-look.mdx', { editor: new TextEditor() }).opened;
        expect(opened.writable).toBe(true);
        expect(opened.text).toBe('edited in the change request\n');
      } finally {
        client.close();
      }
    });

    it('counts the changed pages, committed or not, and the uncommitted files', async () => {
      const worktree = cr.worktree ?? '';
      await git(worktree, 'add', '-A');
      await git(worktree, 'commit', '--quiet', '-m', 'edit first look');
      await writeFile(join(worktree, 'content/notes/guide/new-page.mdx'), '---\ntitle: New\n---\n');
      await writeFile(join(worktree, 'content/notes/guide/meta.yaml'), 'title: Guide\npages:\n  - first-look\n  - new-page\n');
      const found = (await list()).crs.find((each) => each.slug === cr.slug);
      expect(found).toMatchObject({ changedPages: 2, uncommitted: 2, status: 'draft', previewUrl: null, pr: null });
      expect(found?.updatedMs).toBeGreaterThan(Date.now() - 60_000);
    });
  });

  describe('status', () => {
    let cr: ChangeRequest;

    beforeAll(async () => {
      cr = await create('Status check');
    });

    it('is Previewing once the branch is pushed, with its preview link', async () => {
      await git(cr.worktree ?? '', 'push', '--quiet', 'origin', `${cr.branch}:${cr.branch}`);
      const found = (await list()).crs.find((each) => each.slug === cr.slug);
      expect(found).toMatchObject({ status: 'previewing', pushed: true, previewUrl: 'https://cr-status-check.chimey.pages.dev' });
    });

    it('follows the pull request: In review, Merged, Closed', async () => {
      const pr = { number: 81, url: 'https://github.com/o/r/pull/81', headRefName: cr.branch };
      for (const [state, status] of [['OPEN', 'review'], ['MERGED', 'merged'], ['CLOSED', 'closed']] as const) {
        studio.fake.prs = [{ ...pr, state }];
        const found = (await list(true)).crs.find((each) => each.slug === cr.slug);
        expect(found).toMatchObject({ status, pr: { number: 81, url: pr.url } });
      }
    });

    it('is Draft again once its remote branch is deleted, after the next fetch', async () => {
      studio.fake.prs = [];
      await git(repo.origin, 'update-ref', '-d', `refs/heads/${cr.branch}`);
      const other = await create('Triggers a fetch');
      expect((await list(true)).crs.find((each) => each.slug === cr.slug)).toMatchObject({ status: 'draft', pushed: false, previewUrl: null });
      await send(`/api/crs/${other.slug}/discard`, 'POST', {});
      await git(cr.worktree ?? '', 'push', '--quiet', 'origin', `${cr.branch}:${cr.branch}`);
    });

    it('falls back to git when the pull requests cannot be read', async () => {
      studio.fake.prs = new Error('gh: not logged in');
      const answer = await list(true);
      expect(answer.prError).toBe('gh: not logged in');
      expect(answer.crs.find((each) => each.slug === cr.slug)?.status).toBe('previewing');
      studio.fake.prs = [];
    });
  });

  describe('routing', () => {
    it('answers an unknown change request and a non-API path under /cr/ with JSON 404', async () => {
      const unknown = await send('/cr/nope/api/files');
      expect(unknown.status).toBe(404);
      expect(json(unknown)).toEqual({ error: 'no such change request: nope' });
      expect((await send('/cr/_main/api/files')).status).toBe(404);
      const cr = (await list()).crs[0];
      expect((await send(`/cr/${cr.slug}/index.html`)).status).toBe(404);
      expect((await send(`/cr/${cr.slug}/api/nothing`)).status).toBe(404);
      expect((await send(`/cr/${cr.slug}/api/icons`)).status).toBe(200);
    });

    it('refuses a sync upgrade to a slug that is not one, and keeps running', async () => {
      const headers = { Origin: studio.origin };
      for (const path of ['/cr/%E0/__fde_sync', '/cr/nope/__fde_sync', '/cr/a%2Fb/__fde_sync']) {
        expect(await tryUpgrade(`http://127.0.0.1:${studio.port}${path}`, headers)).toBe('refused 404');
      }
      expect((await send('/api/crs')).status).toBe(200);
      expect((await send('/cr/%E0/api/files')).status).toBe(404);
    });
  });

  describe('discarding while a page opens it', () => {
    it('does not wait on the workspace it closes', async () => {
      const cr = await create('Race');
      // A fresh Studio: nothing is open for it yet.
      await studio.close();
      studio = await startCrStudio(repo);
      const discard = send(`/api/crs/${cr.slug}/discard`, 'POST', {});
      const opening = send(`/cr/${cr.slug}/api/files`);
      const timeout = new Promise<'hung'>((resolve) => setTimeout(() => { resolve('hung'); }, 8000));
      expect(await Promise.race([discard.then((response) => response.status), timeout])).toBe(200);
      expect([200, 404]).toContain((await opening).status);
      expect((await send(`/cr/${cr.slug}/api/files`)).status).toBe(404);
      expect((await send('/api/crs', 'POST', { name: 'After the race' })).status).toBe(200);
    }, 15_000);
  });

  describe('discarding', () => {
    let cr: ChangeRequest;

    beforeAll(async () => {
      cr = await create('Throwaway');
      const base = `/cr/${cr.slug}`;
      const { mtimeMs } = await readNote(base, 'content/notes/index.mdx');
      await putNote(base, 'content/notes/index.mdx', 'scratch\n', mtimeMs);
    });

    it('says what goes in a dry run, and removes nothing', async () => {
      const response = await send(`/api/crs/${cr.slug}/discard`, 'POST', { dryRun: true });
      expect(response.status).toBe(200);
      const { discard } = json(response) as { discard: Discard };
      expect(discard).toEqual({ slug: cr.slug, branch: cr.branch, worktree: cr.worktree, commits: 0, uncommitted: 1, pushed: false, pr: null, closesPr: null, unpushed: 0, status: 'draft' });
      expect(existsSync(cr.worktree ?? '')).toBe(true);
    });

    it('removes the worktree and the local branch, and closes its API', async () => {
      expect((await send(`/api/crs/${cr.slug}/discard`, 'POST', {})).status).toBe(200);
      expect(existsSync(cr.worktree ?? '')).toBe(false);
      await expect(git(repo.repo, 'rev-parse', '--verify', cr.branch)).rejects.toThrow();
      expect((await list()).crs.some((each) => each.slug === cr.slug)).toBe(false);
      expect((await send(`/cr/${cr.slug}/api/files`)).status).toBe(404);
      expect((await send(`/api/crs/${cr.slug}/discard`, 'POST', {})).status).toBe(404);
    });
  });

  describe('a worktree removed by hand', () => {
    it('reads as having none while the Studio runs, and is added again when it opens', async () => {
      const cr = await create('Gone while running');
      await rm(cr.worktree ?? '', { recursive: true, force: true });
      const listed = await list();
      expect(listed.crs.find((each) => each.slug === cr.slug)?.worktree).toBeNull();
      expect((await send(`/cr/${cr.slug}/api/files`)).status).toBe(200);
      expect(existsSync(join(cr.worktree ?? '', 'content/notes/index.mdx'))).toBe(true);
      expect((await send(`/api/crs/${cr.slug}/discard`, 'POST', {})).status).toBe(200);
    });

    it('is pruned at startup and added again when the change request opens', async () => {
      const cr = await create('Removed by hand');
      await studio.close();
      await rm(cr.worktree ?? '', { recursive: true, force: true });
      studio = await startCrStudio(repo);
      expect((await git(repo.repo, 'worktree', 'list')).includes(cr.worktree ?? '')).toBe(false);
      expect((await list()).crs.find((each) => each.slug === cr.slug)?.worktree).toBeNull();
      expect((await send(`/cr/${cr.slug}/api/files`)).status).toBe(200);
      expect(existsSync(join(cr.worktree ?? '', 'content/notes/index.mdx'))).toBe(true);
    });
  });
});
