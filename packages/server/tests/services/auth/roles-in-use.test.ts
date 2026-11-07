import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { git } from '#infra/command.ts';
import type { ChangeRequest, Discard } from '#services/cr/manager.ts';
import { fakeAuth, sender, signInWith, startAuthStudio, type AuthStudio, type FakeGitHub, type Send } from '#tests/support/auth.ts';
import { makeGitRepo, startCrStudio, type CrStudio, type GitRepo } from '#tests/support/git-repo.ts';
import { json } from '#tests/support/http.ts';
import { syncWith, TextEditor } from '#tests/support/sync.ts';

const NOTE = 'content/docs/guide/setup.mdx';

describe('what each role may do', () => {
  let studio: AuthStudio;

  beforeAll(async () => {
    studio = await startAuthStudio({ git: true });
    studio.gh.addUser('reader', 'read');
    studio.gh.addUser('writer', 'write', 4242);
  });

  afterAll(async () => {
    await studio.close();
  });

  it('opens notes read only for a reader, writable for a writer', async () => {
    const reader = syncWith(studio.origin, (await studio.signIn('reader')).cookie);
    const writer = syncWith(studio.origin, (await studio.signIn('writer')).cookie);
    try {
      expect((await reader.open('guide/setup.mdx', { editor: new TextEditor() }).opened).writable).toBe(false);
      expect((await writer.open('guide/setup.mdx', { editor: new TextEditor() }).opened).writable).toBe(true);
    } finally {
      reader.close();
      writer.close();
    }
  });

  it('stops writing through an open socket once its session is signed out', async () => {
    const { cookie, csrf } = await studio.signIn('writer');
    const sync = syncWith(studio.origin, cookie);
    try {
      const editor = new TextEditor();
      const doc = sync.open('guide/configuration.mdx', { editor });
      const opened = await doc.opened;
      expect(opened.writable).toBe(true);
      expect((await studio.send('/api/session/logout', { method: 'POST', body: {}, cookie, csrf })).status).toBe(200);
      editor.text = `${opened.text}\nafter signing out\n`;
      doc.changed();
      // The socket is closed (#115): the save waits for a connection that never comes back.
      void doc.flush().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await readFile(join(studio.root, 'content/docs/guide/configuration.mdx'), 'utf8')).toBe(opened.text);
      // Nor does it read any more: the socket is gone and its reconnects are refused.
      expect(sync.status()).toBe('offline');
    } finally {
      sync.close();
    }
  });

  it('commits as the signed-in writer, the host staying the committer', async () => {
    const { cookie, csrf } = await studio.signIn('writer');
    await writeFile(join(studio.root, NOTE), '---\ntitle: Database\n---\n\nBy the writer.\n');
    const response = await studio.send('/api/changes', { method: 'POST', body: { message: 'docs(notes): by the writer', paths: [NOTE] }, cookie, csrf });
    expect(response.status).toBe(200);
    const log = (await git(studio.root, 'log', '-1', '--format=%an <%ae>|%cn <%ce>')).trim();
    expect(log).toBe('Writer Person <4242+writer@users.noreply.github.com>|Studio Test <studio@example.com>');
  });
});

describe('change requests with sign-in', () => {
  let repo: GitRepo;
  let studio: CrStudio;
  let gh: FakeGitHub;
  let send: Send;
  let writer: { cookie: string; csrf: string };
  let admin: { cookie: string; csrf: string };

  const create = async (name: string) => (json(await send('/api/crs', { method: 'POST', body: { name }, ...writer })) as { cr: ChangeRequest }).cr;
  const commitIn = async (cr: ChangeRequest, text: string) => {
    await writeFile(join(cr.worktree ?? '', 'content/docs/guide/first-look.mdx'), `---\ntitle: First look\n---\n\n${text}\n`);
    const response = await send(`/cr/${cr.slug}/api/changes`, { method: 'POST', body: { message: `docs(notes): ${text}`, paths: ['content/docs/guide/first-look.mdx'] }, ...writer });
    expect(response.status).toBe(200);
  };
  const discard = (cr: ChangeRequest, as: { cookie: string; csrf: string }, dryRun = false) =>
    send(`/api/crs/${cr.slug}/discard`, { method: 'POST', body: { dryRun }, ...as });

  beforeAll(async () => {
    repo = await makeGitRepo();
    const faked = fakeAuth(repo.home);
    gh = faked.gh;
    studio = await startCrStudio(repo, { auth: faked.auth });
    send = sender(studio.origin);
    gh.addUser('writer', 'write');
    gh.addUser('admin', 'admin');
    writer = await signInWith(send, gh, 'writer');
    admin = await signInWith(send, gh, 'admin');
  });

  afterAll(async () => {
    await studio.close();
    await repo.remove();
  });

  it('names who published in the pull request gh opens as the host', async () => {
    const cr = await create('Signed publish');
    await commitIn(cr, 'signed');
    const response = await send(`/cr/${cr.slug}/api/publish`, { method: 'POST', body: { title: 'Signed publish', body: '- docs(notes): signed\n' }, ...writer });
    expect(response.status).toBe(200);
    expect(studio.fake.created.at(-1)?.body).toBe('- docs(notes): signed\n\nOpened in Notes Studio by @writer.');
  });

  it('lets a writer discard what is only on this machine', async () => {
    const cr = await create('Local only');
    const response = await discard(cr, writer);
    expect(response.status).toBe(200);
  });

  it('leaves what is on origin to an admin', async () => {
    const cr = await create('On origin');
    await commitIn(cr, 'pushed');
    expect((await send(`/cr/${cr.slug}/api/preview`, { method: 'POST', body: {}, ...writer })).status).toBe(200);
    // The dry run still tells the writer what a discard would remove.
    expect(((json(await discard(cr, writer, true)) as { discard: Discard }).discard).pushed).toBe(true);
    const refused = await discard(cr, writer);
    expect(refused.status).toBe(403);
    expect((json(refused) as { error: string }).error).toBe(`${cr.branch} is on origin: cleaning it up there needs admin access to the repository. Nothing was removed.`);
    expect((await git(repo.origin, 'for-each-ref', `refs/heads/${cr.branch}`)).trim()).not.toBe('');
    expect((await discard(cr, admin)).status).toBe(200);
    expect((await git(repo.origin, 'for-each-ref', `refs/heads/${cr.branch}`)).trim()).toBe('');
  });
});
