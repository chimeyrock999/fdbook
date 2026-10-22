import type { IncomingMessage } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectionStatus, SyncClient } from '@fumadocs-editor/core/sync';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAuth } from '../../../server/auth/auth';
import type { ChangeRequest } from '../../../server/cr/manager';
import { viewerOf } from '../../../server/security/access';
import { fakeAuth, sender, signInWith, startAuthStudio, testAuthConfig, type AuthStudio, type FakeGitHub } from '../../support/auth';
import { makeGitRepo, startCrStudio, type CrStudio, type GitRepo } from '../../support/git-repo';
import { json } from '../../support/http';
import { syncWith, TextEditor } from '../../support/sync';

const PAGE = 'streaming/index.mdx';
const CHECK_MS = 50;

async function until(check: () => boolean, what: string) {
  const end = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// The connection statuses a sync client went through.
function statuses(client: SyncClient) {
  const seen: ConnectionStatus[] = [client.status()];
  client.onStatus((status) => { seen.push(status); });
  return seen;
}

// An open sync socket outlives the check made when it opened: fumadocs-
// editor relays every update of an open document to its connections. The
// Studio closes the sockets of a session that ended instead (#115).
describe('open sync sockets once the session ends', () => {
  let studio: AuthStudio;
  const clients: SyncClient[] = [];
  const open = (cookie: string) => {
    const client = syncWith(studio.origin, cookie);
    clients.push(client);
    return client;
  };

  beforeAll(async () => {
    studio = await startAuthStudio({ checkEveryMs: CHECK_MS });
    studio.gh.addUser('alice', 'write');
    studio.gh.addUser('bob', 'write');
  });

  afterEach(() => {
    for (const client of clients.splice(0)) client.close();
  });

  afterAll(async () => {
    await studio.close();
  });

  // Alice and Bob open the same page; Bob writes `line` and saves it.
  async function bobWrites(alice: SyncClient, bob: SyncClient, line: string, between: () => Promise<void> = () => Promise.resolve()) {
    const aliceEditor = new TextEditor();
    const bobEditor = new TextEditor();
    await alice.open(PAGE, { editor: aliceEditor }).opened;
    const bobDoc = bob.open(PAGE, { editor: bobEditor });
    const opened = await bobDoc.opened;
    await between();
    bobEditor.text = `${opened.text}\n${line}\n`;
    bobDoc.changed();
    await bobDoc.flush();
    return aliceEditor;
  }

  it('relays an edit to another open socket while both are signed in', async () => {
    const alice = open((await studio.signIn('alice')).cookie);
    const bob = open((await studio.signIn('bob')).cookie);
    const aliceEditor = await bobWrites(alice, bob, 'both signed in');
    await until(() => aliceEditor.received.some((text) => text.includes('both signed in')), 'the edit to reach Alice');
  });

  it('closes the socket of a session signed out, so later edits never reach it', async () => {
    const { cookie, csrf } = await studio.signIn('alice');
    const alice = open(cookie);
    const bob = open((await studio.signIn('bob')).cookie);
    const seen = statuses(alice);
    const aliceEditor = await bobWrites(alice, bob, 'after Alice signed out', async () => {
      expect((await studio.send('/api/session/logout', { method: 'POST', body: {}, cookie, csrf })).status).toBe(200);
      await until(() => seen.includes('offline'), 'Alice’s socket to close');
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(aliceEditor.received.join('\n')).not.toContain('after Alice signed out');
    // Its reconnects are refused: the session is gone.
    expect(alice.status()).not.toBe('online');
  });

  it('leaves the sockets of other sessions open', async () => {
    const { cookie, csrf } = await studio.signIn('alice');
    const otherTab = open((await studio.signIn('alice')).cookie);
    const seen = statuses(otherTab);
    open(cookie);
    await otherTab.open(PAGE, { editor: new TextEditor() }).opened;
    expect((await studio.send('/api/session/logout', { method: 'POST', body: {}, cookie, csrf })).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, CHECK_MS * 4));
    expect(seen).not.toContain('offline');
    expect(otherTab.status()).toBe('online');
  });

  it('closes the socket of a session that expired at the next check', async () => {
    const { cookie } = await studio.signIn('alice');
    const alice = open(cookie);
    const seen = statuses(alice);
    await alice.open(PAGE, { editor: new TextEditor() }).opened;
    const session = studio.auth.sessions.get(cookie.split('=')[1] ?? null);
    if (session === null) throw new Error('no session');
    session.expiresAt = Date.now() - 1;
    await until(() => seen.includes('offline'), 'the expired socket to close');
  });
});

describe('open sync sockets of a change request', () => {
  let repo: GitRepo;
  let studio: CrStudio;
  let gh: FakeGitHub;

  beforeAll(async () => {
    repo = await makeGitRepo();
    const faked = fakeAuth(repo.home, testAuthConfig(), { checkEveryMs: CHECK_MS });
    gh = faked.gh;
    studio = await startCrStudio(repo, { auth: faked.auth });
    gh.addUser('writer', 'write');
  });

  afterAll(async () => {
    await studio.close();
    await repo.remove();
  });

  it('closes them on sign-out too', async () => {
    const send = sender(studio.origin);
    const writer = await signInWith(send, gh, 'writer');
    const { cr } = json(await send('/api/crs', { method: 'POST', body: { name: 'Socket closes' }, ...writer })) as { cr: ChangeRequest };
    const client = syncWith(studio.origin, writer.cookie, `/cr/${cr.slug}`);
    try {
      const seen = statuses(client);
      await client.open('guide/first-look.mdx', { editor: new TextEditor() }).opened;
      expect((await send('/api/session/logout', { method: 'POST', body: {}, ...writer })).status).toBe(200);
      await until(() => seen.includes('offline'), 'the change request’s socket to close');
    } finally {
      client.close();
    }
  });
});

// Access taken away on GitHub shows once the role cache reads it again;
// the socket closes at the check after that.
describe('a viewer watched for its end', () => {
  let home: string;

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'notes-studio-home-'));
  });

  afterAll(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('ends once the role falls below reader', async () => {
    const { auth: options } = fakeAuth(home, testAuthConfig(), { checkEveryMs: CHECK_MS });
    let role: 'writer' | 'none' = 'writer';
    const roles = Object.assign(() => Promise.resolve(role), { peek: () => role });
    const auth = createAuth({ ...options, roles }, 4310);
    const { id } = await options.sessions.create({ id: 1, login: 'alice', name: 'Alice', avatarUrl: '' });
    const request = { headers: { cookie: `studio_session_4310=${id}` } } as unknown as IncomingMessage;
    expect(await auth.gateUpgrade(request, 'reader')).toBeNull();
    const lost = vi.fn();
    const stop = viewerOf(request).watch(lost);
    await new Promise((resolve) => setTimeout(resolve, CHECK_MS * 3));
    expect(lost).not.toHaveBeenCalled();
    role = 'none';
    await until(() => lost.mock.calls.length > 0, 'the viewer to end');
    expect(lost).toHaveBeenCalledTimes(1);
    stop();
    await options.sessions.saved();
  });

  it('ends at once when the session was signed out before the watch began', async () => {
    const { auth: options } = fakeAuth(home, testAuthConfig(), { checkEveryMs: CHECK_MS });
    const auth = createAuth({ ...options, roles: Object.assign(() => Promise.resolve('writer' as const), { peek: () => 'writer' as const }) }, 4310);
    const { id } = await options.sessions.create({ id: 1, login: 'alice', name: 'Alice', avatarUrl: '' });
    const request = { headers: { cookie: `studio_session_4310=${id}` } } as unknown as IncomingMessage;
    expect(await auth.gateUpgrade(request, 'reader')).toBeNull();
    // Signed out between the gate and the upgrade reaching the sync.
    await options.sessions.remove(id);
    const lost = vi.fn();
    viewerOf(request).watch(lost);
    expect(lost).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, CHECK_MS * 3));
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('is never ended with sign-in off', () => {
    const request = { headers: {} } as unknown as IncomingMessage;
    const lost = vi.fn();
    viewerOf(request).watch(lost)();
    expect(lost).not.toHaveBeenCalled();
  });
});
