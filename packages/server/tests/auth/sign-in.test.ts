import { writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { SYNC_ENDPOINT } from '@fumadocs-editor/core/sync';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { json, tryUpgrade } from '#tests/support/http.ts';
import { startAuthStudio, testAuthConfig, type AuthStudio } from '#tests/support/auth.ts';

const NOTE = 'content/docs/guide/setup.mdx';
const fileApi = (path: string) => `/api/file?path=${encodeURIComponent(path)}`;

// Sign-in with GitHub through the real server: the device and web flows,
// the gate on every /api route and websocket, and the csrf token (#99).
describe('sign-in', () => {
  let studio: AuthStudio;

  beforeAll(async () => {
    studio = await startAuthStudio();
    studio.gh.addUser('reader', 'triage');
    studio.gh.addUser('writer', 'maintain');
    studio.gh.addUser('admin', 'admin');
    studio.gh.addUser('outsider', 'none');
  });

  afterAll(async () => {
    await studio.close();
  });

  describe('the session API', () => {
    it('says how to sign in when nobody is signed in', async () => {
      const response = await studio.send('/api/session');
      expect(response.status).toBe(200);
      expect(json(response)).toEqual({ auth: 'github', flows: ['device', 'web'], repo: 'owner/notes', user: null, role: null, csrf: null });
    });

    it('signs in through the device flow, waiting while GitHub does', async () => {
      const started = await studio.send('/api/session/device', { method: 'POST', body: {} });
      expect(started.status).toBe(200);
      const { flow, userCode, verificationUri, interval } = json(started) as { flow: string; userCode: string; verificationUri: string; interval: number };
      expect({ userCode, verificationUri, interval }).toEqual({ userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', interval: 5 });

      studio.gh.fake.polls.push({ state: 'pending', interval: null }, { state: 'pending', interval: 10 }, { state: 'done', token: 'writer' });
      expect(json(await studio.send('/api/session/device/poll', { method: 'POST', body: { flow } }))).toEqual({ state: 'pending', interval: null });
      expect(json(await studio.send('/api/session/device/poll', { method: 'POST', body: { flow } }))).toEqual({ state: 'pending', interval: 10 });
      const done = await studio.send('/api/session/device/poll', { method: 'POST', body: { flow } });
      expect(done.status).toBe(200);
      const cookie = String(done.headers['set-cookie']?.[0]);
      expect(cookie).toMatch(new RegExp(`^studio_session_${studio.port}=[\\w-]{40,}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800$`));
      const { session } = json(done) as { session: { user: { login: string }; role: string; csrf: string } };
      expect(session).toMatchObject({ user: { login: 'writer', name: 'Writer Person', avatarUrl: 'https://avatars.example/writer' }, role: 'writer' });

      const state = json(await studio.send('/api/session', { cookie: cookie.split(';')[0] })) as { user: { login: string }; csrf: string };
      expect(state.user.login).toBe('writer');
      expect(state.csrf).toBe(session.csrf);
      // A finished code cannot be polled again.
      expect((await studio.send('/api/session/device/poll', { method: 'POST', body: { flow } })).status).toBe(410);
    });

    it('answers an expired, cancelled or unknown code', async () => {
      for (const [poll, status] of [[{ state: 'expired' }, 410], [{ state: 'denied' }, 403]] as const) {
        const { flow } = json(await studio.send('/api/session/device', { method: 'POST', body: {} })) as { flow: string };
        studio.gh.fake.polls.push(poll);
        expect((await studio.send('/api/session/device/poll', { method: 'POST', body: { flow } })).status).toBe(status);
      }
      expect((await studio.send('/api/session/device/poll', { method: 'POST', body: { flow: 'made-up' } })).status).toBe(410);
    });

    it('refuses someone without access after they sign in, naming them', async () => {
      const { flow } = json(await studio.send('/api/session/device', { method: 'POST', body: {} })) as { flow: string };
      studio.gh.fake.polls.push({ state: 'done', token: 'outsider' });
      const refused = await studio.send('/api/session/device/poll', { method: 'POST', body: { flow } });
      expect(refused.status).toBe(403);
      expect(refused.headers['set-cookie']).toBeUndefined();
      expect(json(refused)).toEqual({ error: '@outsider has no access to owner/notes.' });
    });

    it('keeps a confirmed code when signing in fails for a moment, and finishes on the next poll', async () => {
      studio.gh.addUser('patient', new Error('gh: timed out'));
      const { flow } = json(await studio.send('/api/session/device', { method: 'POST', body: {} })) as { flow: string };
      studio.gh.fake.polls.push({ state: 'done', token: 'patient' });
      const failed = await studio.send('/api/session/device/poll', { method: 'POST', body: { flow } });
      expect(failed.status).toBe(502);
      studio.gh.fake.roleNames.set('patient', 'read');
      // No second poll of GitHub: the token it gave is kept until sign-in is done.
      const done = await studio.send('/api/session/device/poll', { method: 'POST', body: { flow } });
      expect(done.status).toBe(200);
      expect((json(done) as { session: { user: { login: string } } }).session.user.login).toBe('patient');
      expect(studio.gh.fake.polls).toEqual([]);
    });

    it('starts a sign-in only from a JSON request', async () => {
      expect((await studio.send('/api/session/device', { method: 'POST', body: 'flow', headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
    });

    it('signs out with the csrf token, and only with it', async () => {
      const { cookie, csrf } = await studio.signIn('reader');
      expect((await studio.send('/api/session/logout', { method: 'POST', body: {}, cookie })).status).toBe(403);
      const out = await studio.send('/api/session/logout', { method: 'POST', body: {}, cookie, csrf });
      expect(out.status).toBe(200);
      expect(String(out.headers['set-cookie']?.[0])).toContain('Max-Age=0');
      expect((json(await studio.send('/api/session', { cookie })) as { user: unknown }).user).toBeNull();
      expect((await studio.send(fileApi(NOTE), { cookie })).status).toBe(401);
    });
  });

  describe('the web flow', () => {
    it('sends the browser to GitHub with a state cookie, and back signs in', async () => {
      const start = await studio.send('/api/session/web');
      expect(start.status).toBe(302);
      const location = new URL(String(start.headers.location));
      expect(location.searchParams.get('redirect_uri')).toBe(`${studio.origin}/api/session/callback`);
      const state = location.searchParams.get('state') ?? '';
      const stateCookie = String(start.headers['set-cookie']?.[0]);
      expect(stateCookie).toBe(`studio_oauth_${studio.port}=${state}; Path=/api/session; HttpOnly; SameSite=Lax; Max-Age=600`);

      // GitHub's redirect back is a cross-site navigation: the guard lets this one path through.
      const back = await studio.send(`/api/session/callback?code=admin&state=${state}`, {
        cookie: stateCookie.split(';')[0],
        headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' },
      });
      expect(back.status).toBe(302);
      expect(back.headers.location).toBe('/');
      expect(studio.gh.fake.exchanged.at(-1)).toEqual({ code: 'admin', redirectUri: `${studio.origin}/api/session/callback` });
      const session = String((back.headers['set-cookie'] as string[]).find((each) => each.startsWith('studio_session_'))).split(';')[0];
      expect((json(await studio.send('/api/session', { cookie: session })) as { role: string }).role).toBe('admin');

      // The state is used up.
      const again = await studio.send(`/api/session/callback?code=admin&state=${state}`, { cookie: stateCookie.split(';')[0] });
      expect(String(again.headers.location)).toMatch(/^\/\?signin_error=/);
    });

    it('starts the web sign-in again on the host the OAuth App calls back to', async () => {
      const start = await studio.send('/api/session/web', { headers: { Host: `localhost:${studio.port}` } });
      expect(start.status).toBe(302);
      expect(start.headers.location).toBe(`${studio.origin}/api/session/web`);
      expect(start.headers['set-cookie']).toBeUndefined();
    });

    it('refuses a callback whose state is not this browser\'s', async () => {
      const start = await studio.send('/api/session/web');
      const state = new URL(String(start.headers.location)).searchParams.get('state') ?? '';
      const back = await studio.send(`/api/session/callback?code=admin&state=${state}`, { cookie: `studio_oauth_${studio.port}=someone-else` });
      expect(back.status).toBe(302);
      expect(decodeURIComponent(String(back.headers.location))).toContain('came from another browser');
      expect((back.headers['set-cookie'] as string[]).some((each) => each.startsWith('studio_session_'))).toBe(false);
    });

    it('still refuses other cross-site requests', async () => {
      const headers = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' };
      expect((await studio.send('/api/session', { headers })).status).toBe(403);
      expect((await studio.send('/api/session/callback?code=x&state=y', { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' } })).status).toBe(403);
    });
  });

  describe('the gate', () => {
    it('lets the app shell load before sign-in, but no API', async () => {
      expect((await studio.send('/')).status).toBe(200);
      const refused = await studio.send(fileApi(NOTE));
      expect(refused.status).toBe(401);
      expect(json(refused)).toEqual({ error: 'Sign in to use the Studio.' });
      expect((await studio.send('/api/events')).status).toBe(401);
    });

    it('lets a reader read and lint, nothing more', async () => {
      const { cookie, csrf } = await studio.signIn('reader');
      expect((await studio.send(fileApi(NOTE), { cookie })).status).toBe(200);
      expect((await studio.send('/api/lint', { method: 'POST', body: { path: NOTE, content: 'x' }, cookie, csrf })).status).not.toBe(403);
      const write = await studio.send(fileApi(NOTE), { method: 'PUT', body: { content: 'x' }, cookie, csrf });
      expect(write.status).toBe(403);
      expect(json(write)).toEqual({ error: 'This needs writer access; @reader is a reader.' });
    });

    it('lets a reader read page history but not restore it (#110)', async () => {
      const { cookie, csrf } = await studio.signIn('reader');
      expect((await studio.send(`/api/history?path=${encodeURIComponent(NOTE)}`)).status).toBe(401);
      expect((await studio.send(`/api/history?path=${encodeURIComponent(NOTE)}`, { cookie })).status).not.toBe(401);
      const restore = await studio.send('/api/history/restore', { method: 'POST', body: { path: NOTE, sha: 'HEAD', mtimeMs: 0 }, cookie, csrf });
      expect(restore.status).toBe(403);
      expect(json(restore)).toEqual({ error: 'This needs writer access; @reader is a reader.' });
    });

    it('lets a writer write, with the csrf token only', async () => {
      const { cookie, csrf } = await studio.signIn('writer');
      const { mtimeMs, content } = json(await studio.send(fileApi(NOTE), { cookie })) as { mtimeMs: number; content: string };
      const body = { content: `${content}\nby the writer\n`, baseMtime: mtimeMs };
      const without = await studio.send(fileApi(NOTE), { method: 'PUT', body, cookie });
      expect(without.status).toBe(403);
      expect(json(without)).toEqual({ error: 'missing or wrong csrf token' });
      expect((await studio.send(fileApi(NOTE), { method: 'PUT', body, cookie, csrf: `${csrf}x` })).status).toBe(403);
      // As many characters, more bytes: refused, not a crash.
      expect((await studio.send(fileApi(NOTE), { method: 'PUT', body, cookie, csrf: `é${csrf.slice(1)}` })).status).toBe(403);
      expect((await studio.send(fileApi(NOTE), { method: 'PUT', body, cookie, csrf })).status).toBe(200);
    });

    it('follows a role taken away, once the cache is read again', async () => {
      studio.gh.addUser('leaver', 'write');
      const { cookie } = await studio.signIn('leaver');
      studio.gh.fake.roleNames.set('leaver', 'none');
      // Within the cache the old role holds; the next fresh read refuses.
      expect((await studio.send(fileApi(NOTE), { cookie })).status).toBe(200);
      await studio.auth.roles('leaver', true);
      expect((await studio.send(fileApi(NOTE), { cookie })).status).toBe(403);
      expect((json(await studio.send('/api/session', { cookie })) as { role: string }).role).toBe('none');
    });

    it('answers 503 when the repository access cannot be read, without guessing', async () => {
      studio.gh.addUser('flaky', 'write');
      const { cookie } = await studio.signIn('flaky');
      studio.gh.fake.roleNames.set('flaky', new Error('gh: not logged in'));
      // A failed read keeps the role read before while it is fresh; once it is stale, nothing is guessed.
      expect((await studio.send(fileApi(NOTE), { cookie })).status).toBe(200);
      const now = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 6 * 60_000);
      try {
        const response = await studio.send(fileApi(NOTE), { cookie });
        expect(response.status).toBe(503);
        expect((json(response) as { error: string }).error).toContain('gh: not logged in');
        // In JSON: the connection watch reads it as the Studio still there (#163).
        const session = await studio.send('/api/session', { cookie });
        expect(session.status).toBe(503);
        expect(session.headers['content-type']).toMatch(/^application\/json/);
        expect((json(session) as { error: string }).error).toContain('gh: not logged in');
        // What needs no role (the page and its modules) does not wait for gh.
        expect((await studio.send('/', { cookie })).status).toBe(200);
      } finally {
        clock.mockRestore();
      }
    });

    it('ends an open file events stream once its session is signed out', async () => {
      const { cookie, csrf } = await studio.signIn('reader');
      const frames: string[] = [];
      let ended = false;
      const stream = request(`${studio.origin}/api/events`, { headers: { Cookie: cookie } });
      await new Promise<void>((resolve, reject) => {
        stream.on('response', (response) => {
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => frames.push(chunk));
          response.on('end', () => { ended = true; });
          resolve();
        });
        stream.on('error', reject);
        stream.end();
      });
      try {
        await writeFile(join(studio.root, NOTE), '---\ntitle: Database\n---\n\nBefore signing out.\n');
        await expect.poll(() => frames.join('').includes('"type":"change"'), { timeout: 5000 }).toBe(true);
        expect((await studio.send('/api/session/logout', { method: 'POST', body: {}, cookie, csrf })).status).toBe(200);
        const seen = frames.join('').length;
        await writeFile(join(studio.root, NOTE), '---\ntitle: Database\n---\n\nAfter signing out.\n');
        await expect.poll(() => ended, { timeout: 5000 }).toBe(true);
        expect(frames.join('').slice(seen)).not.toContain('"type"');
      } finally {
        stream.destroy();
      }
    });

    it('refuses the sync socket without a session, and opens it with one', async () => {
      const url = `${studio.origin}${SYNC_ENDPOINT}`;
      expect(await tryUpgrade(url, { Origin: studio.origin })).toBe('refused 401');
      const { cookie } = await studio.signIn('reader');
      expect(await tryUpgrade(url, { Origin: studio.origin, Cookie: cookie })).toBe('upgraded');
      expect(await tryUpgrade(`${studio.origin}/cr/nothing${SYNC_ENDPOINT}`, { Origin: studio.origin })).toBe('refused 401');
      // Vite's own socket carries no notes.
      expect(await tryUpgrade(`${studio.origin}/`, { 'Sec-WebSocket-Protocol': 'vite-ping' })).toBe('upgraded');
    });

    it('keeps two Studios on one host apart: the cookie names the port', async () => {
      const { cookie } = await studio.signIn('reader');
      const other = cookie.replace(`studio_session_${studio.port}=`, 'studio_session_1=');
      expect((await studio.send(fileApi(NOTE), { cookie: other })).status).toBe(401);
    });
  });

  it('lets only the allowed users in when STUDIO_ALLOWED_USERS is set', async () => {
    const allowed = await startAuthStudio({ config: testAuthConfig({ allowedUsers: ['alice'] }) });
    try {
      allowed.gh.addUser('alice', 'read');
      allowed.gh.addUser('bob', 'admin');
      expect((json(await allowed.send(fileApi(NOTE), { cookie: (await allowed.signIn('alice')).cookie })) as { content: string }).content).toBeTypeOf('string');
      await expect(allowed.signIn('bob')).rejects.toThrow('@bob is not in STUDIO_ALLOWED_USERS.');
    } finally {
      await allowed.close();
    }
  });

  it('offers only the configured flows', async () => {
    const deviceOnly = await startAuthStudio({ config: testAuthConfig({ flows: ['device'], clientSecret: null }) });
    try {
      expect((json(await deviceOnly.send('/api/session')) as { flows: string[] }).flows).toEqual(['device']);
      expect((await deviceOnly.send('/api/session/web')).status).toBe(404);
    } finally {
      await deviceOnly.close();
    }
  });
});
