import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConnectionStatus, SyncClient } from '@fumadocs-editor/core/sync';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startAuthStudio, type AuthStudio } from '#tests/support/auth.ts';
import { json } from '#tests/support/http.ts';
import { syncSignedIn, TextEditor } from '#tests/support/sync.ts';

const PAGE = 'streaming/index.mdx';
const CHECK_MS = 50;

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 8000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// A writer's edit that the session ending kept from saving: the socket
// closes (#115) and its reconnects are refused, so the edit waits in the
// editor. The page keeps the editor mounted under the sign-in (#121); once
// signed in again, the next reconnect carries the new cookie and the
// autosave writes the edit.
describe('an edit made as the session ends', () => {
  let studio: AuthStudio;
  const clients: SyncClient[] = [];
  const page = () => readFile(join(studio.root, 'content/docs', PAGE), 'utf8');

  beforeAll(async () => {
    studio = await startAuthStudio({ checkEveryMs: CHECK_MS });
    studio.gh.addUser('alice', 'write');
  });

  afterEach(() => {
    for (const client of clients.splice(0)) client.close();
  });

  afterAll(async () => {
    await studio.close();
  });

  it('is saved once the writer signs in again', async () => {
    const { cookie, csrf } = await studio.signIn('alice');
    const jar = { cookie };
    const client = syncSignedIn(studio.origin, jar);
    clients.push(client);
    const seen: ConnectionStatus[] = [];
    client.onStatus((status) => { seen.push(status); });
    const editor = new TextEditor();
    const doc = client.open(PAGE, { editor });
    const opened = await doc.opened;
    expect(opened.writable).toBe(true);

    expect((await studio.send('/api/session/logout', { method: 'POST', body: {}, cookie, csrf })).status).toBe(200);
    await until(() => seen.includes('offline'), 'the socket to close');
    const edited = `${opened.text}\nWritten as the session ended.\n`;
    editor.text = edited;
    doc.changed();
    await doc.flush();
    expect(doc.status()).toBe('offline');
    // Reconnects with the old cookie are refused: nothing reaches the disk.
    await new Promise((resolve) => setTimeout(resolve, CHECK_MS * 6));
    expect(client.status()).not.toBe('online');
    expect(await page()).toBe(opened.text);

    jar.cookie = (await studio.signIn('alice')).cookie;
    await until(async () => (await page()) === edited, 'the edit to be saved');
    expect(doc.status()).toBe('synced');
  }, 15_000);

  // Another tab signs out, then in as someone else: the browser's cookie is
  // Carol's now. The page's seat check (checkSeat, here a stand-in that
  // reads the session the same way) refuses each reconnect, so Alice's
  // edit is not written as Carol.
  it('is not saved as someone else signed in from another tab', async () => {
    studio.gh.addUser('carol', 'write');
    const { cookie, csrf } = await studio.signIn('alice');
    const jar = { cookie };
    const login = async () => (json(await studio.send('/api/session', { cookie: jar.cookie })) as { user: { login: string } | null }).user?.login;
    let refused = 0;
    const client = syncSignedIn(studio.origin, jar, async () => {
      if ((await login()) !== 'alice') {
        refused += 1;
        throw new Error('someone else');
      }
    });
    clients.push(client);
    const seen: ConnectionStatus[] = [];
    client.onStatus((status) => { seen.push(status); });
    const editor = new TextEditor();
    const doc = client.open(PAGE, { editor });
    const opened = await doc.opened;

    expect((await studio.send('/api/session/logout', { method: 'POST', body: {}, cookie, csrf })).status).toBe(200);
    await until(() => seen.includes('offline'), 'the socket to close');
    editor.text = `${opened.text}\nAlice's, not Carol's.\n`;
    doc.changed();
    jar.cookie = (await studio.signIn('carol')).cookie;
    await until(() => refused >= 2, 'reconnects as Carol to be refused');
    expect(client.status()).not.toBe('online');
    expect(await page()).toBe(opened.text);
  }, 15_000);

  it('is not saved for someone signed in again as a reader', async () => {
    studio.gh.addUser('bob', 'write');
    const { cookie, csrf } = await studio.signIn('bob');
    const jar = { cookie };
    const client = syncSignedIn(studio.origin, jar);
    clients.push(client);
    const seen: ConnectionStatus[] = [];
    client.onStatus((status) => { seen.push(status); });
    const editor = new TextEditor();
    const doc = client.open(PAGE, { editor });
    const opened = await doc.opened;

    expect((await studio.send('/api/session/logout', { method: 'POST', body: {}, cookie, csrf })).status).toBe(200);
    await until(() => seen.includes('offline'), 'the socket to close');
    editor.text = `${opened.text}\nBob, no longer a writer.\n`;
    doc.changed();
    studio.gh.fake.roleNames.set('bob', 'read');
    jar.cookie = (await studio.signIn('bob')).cookie;
    await until(() => seen.at(-1) === 'online', 'the reader to reconnect');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // The page offers the edit back instead (useUnsaved): it is not lost,
    // and the reader's socket wrote nothing.
    expect(await page()).toBe(opened.text);
    expect(editor.text).toContain('Bob, no longer a writer.');
  }, 15_000);
});
