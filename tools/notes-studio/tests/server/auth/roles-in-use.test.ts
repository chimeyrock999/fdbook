import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSyncClient, SYNC_ENDPOINT, wsTransport, type DocumentEditor } from '@fumadocs-editor/core/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { git } from '../../../server/cr/git';
import type { ChangeRequest, Discard } from '../../../server/cr/manager';
import { fakeAuth, sender, signInWith, startAuthStudio, type AuthStudio, type FakeGitHub, type Send } from '../../support/auth';
import { makeGitRepo, startCrStudio, type CrStudio, type GitRepo } from '../../support/git-repo';
import { json } from '../../support/http';

const NOTE = 'content/notes/database/index.mdx';

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

// Opens the notes sync as the browser would, with the session cookie.
function syncWith(studio: AuthStudio, cookie: string) {
  const original = globalThis.WebSocket;
  class WithCookie extends original {
    constructor(url: string | URL) {
      // undici's WebSocket takes headers in its init; browsers send the cookie themselves.
      super(url, { headers: { Cookie: cookie, Origin: studio.origin } } as unknown as string[]);
    }
  }
  globalThis.WebSocket = WithCookie;
  try {
    return createSyncClient({ transport: wsTransport(`ws://127.0.0.1:${studio.port}${SYNC_ENDPOINT}`) });
  } finally {
    queueMicrotask(() => { globalThis.WebSocket = original; });
  }
}

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
    const reader = syncWith(studio, (await studio.signIn('reader')).cookie);
    const writer = syncWith(studio, (await studio.signIn('writer')).cookie);
    try {
      expect((await reader.open('database/index.mdx', { editor: new TextEditor() }).opened).writable).toBe(false);
      expect((await writer.open('database/index.mdx', { editor: new TextEditor() }).opened).writable).toBe(true);
    } finally {
      reader.close();
      writer.close();
    }
  });

  it('stops writing through an open socket once its session is signed out', async () => {
    const { cookie, csrf } = await studio.signIn('writer');
    const sync = syncWith(studio, cookie);
    try {
      const editor = new TextEditor();
      const doc = sync.open('streaming/index.mdx', { editor });
      const opened = await doc.opened;
      expect(opened.writable).toBe(true);
      expect((await studio.send('/api/session/logout', { method: 'POST', body: {}, cookie, csrf })).status).toBe(200);
      editor.text = `${opened.text}\nafter signing out\n`;
      doc.changed();
      await doc.flush().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await readFile(join(studio.root, 'content/notes/streaming/index.mdx'), 'utf8')).toBe(opened.text);
      // Nor does it read any more.
      await expect(sync.open('database/index.mdx', { editor: new TextEditor() }).opened).rejects.toThrow();
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
    await writeFile(join(cr.worktree ?? '', 'content/notes/guide/first-look.mdx'), `---\ntitle: First look\n---\n\n${text}\n`);
    const response = await send(`/cr/${cr.slug}/api/changes`, { method: 'POST', body: { message: `docs(notes): ${text}`, paths: ['content/notes/guide/first-look.mdx'] }, ...writer });
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
