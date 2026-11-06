import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuthOptions } from '../../server/auth/auth';
import type { AuthConfig } from '../../server/auth/config';
import type { DevicePoll, GitHub, GitHubUser } from '../../server/auth/github';
import { createRoleReader } from '../../server/auth/roles';
import { createSessionStore } from '../../server/auth/sessions';
import { startStudioServer } from '../../server/studio-server';
import { makeGitWorktree } from './git';
import { json, rawRequest, type RawResponse } from './http';
import { makeWorktree } from './studio';

// GitHub as sign-in sees it. A device code polls through `polls` (then
// stays pending); a token is a login of `users`; `roleNames` is each
// login's role name on the repository, or an Error to fail the lookup.
export function fakeGitHub() {
  const fake = {
    polls: [] as DevicePoll[],
    users: new Map<string, GitHubUser>(),
    roleNames: new Map<string, string | Error>(),
    lookups: 0,
    codes: [] as string[],
    exchanged: [] as { code: string; redirectUri: string }[],
  };
  const github: GitHub = {
    deviceCode: () => {
      fake.codes.push(`device-${String(fake.codes.length)}`);
      return Promise.resolve({ deviceCode: fake.codes.at(-1) ?? '', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5 });
    },
    pollDevice: () => Promise.resolve(fake.polls.shift() ?? { state: 'pending', interval: null }),
    authorizeUrl: (redirectUri, state) => `https://github.com/login/oauth/authorize?${new URLSearchParams({ redirect_uri: redirectUri, state }).toString()}`,
    exchangeCode: (code, redirectUri) => {
      fake.exchanged.push({ code, redirectUri });
      return Promise.resolve(code);
    },
    user: (token) => {
      const user = fake.users.get(token);
      return user === undefined ? Promise.reject(new Error('bad token')) : Promise.resolve(user);
    },
  };
  const addUser = (login: string, roleName: string | Error, id = 1000 + fake.users.size) => {
    fake.users.set(login, { id, login, name: `${login.charAt(0).toUpperCase()}${login.slice(1)} Person`, avatarUrl: `https://avatars.example/${login}` });
    fake.roleNames.set(login, roleName);
  };
  const permission = (login: string) => {
    fake.lookups += 1;
    const name = fake.roleNames.get(login) ?? 'none';
    return name instanceof Error ? Promise.reject(name) : Promise.resolve(name);
  };
  return { fake, github, addUser, permission };
}

export type FakeGitHub = ReturnType<typeof fakeGitHub>;

export const testAuthConfig = (overrides: Partial<AuthConfig> = {}): AuthConfig => ({
  clientId: 'client-id',
  clientSecret: 'client-secret',
  flows: ['device', 'web'],
  allowedUsers: [],
  sessionDays: 7,
  ...overrides,
});

export type Send = (path: string, options?: { method?: string; body?: unknown; cookie?: string; csrf?: string; headers?: Record<string, string> }) => Promise<RawResponse>;

// A request to the Studio at `origin`, as its page sends it: JSON with
// its Origin, the session cookie and the csrf header when given.
export function sender(origin: string): Send {
  return (path, { method = 'GET', body, cookie, csrf, headers = {} } = {}) =>
    rawRequest(`${origin}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }),
        ...(cookie === undefined ? {} : { Cookie: cookie }),
        ...(csrf === undefined ? {} : { 'X-Studio-Csrf': csrf }),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
}

// Signs `login` in through the device flow; answers the cookie and csrf token to send.
export async function signInWith(send: Send, gh: FakeGitHub, login: string) {
  const started = json(await send('/api/session/device', { method: 'POST', body: {} })) as { flow: string };
  gh.fake.polls.push({ state: 'done', token: login });
  const done = await send('/api/session/device/poll', { method: 'POST', body: { flow: started.flow } });
  if (done.status !== 200) throw new Error(`sign-in of ${login} failed: ${done.body.toString('utf8')}`);
  const cookie = (done.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
  const { session } = json(done) as { session: { csrf: string } };
  return { cookie, csrf: session.csrf };
}

// Sign-in options over a faked GitHub, sessions in `home`; `checkEveryMs`
// is how often open sockets are checked (auth.ts).
export function fakeAuth(home: string, config = testAuthConfig(), { checkEveryMs }: { checkEveryMs?: number } = {}) {
  const gh = fakeGitHub();
  const auth: AuthOptions = {
    config,
    checkEveryMs,
    github: gh.github,
    repo: { name: () => Promise.resolve('owner/notes'), permission: gh.permission },
    roles: createRoleReader(gh.permission, config.allowedUsers),
    sessions: createSessionStore(join(home, 'sessions.json'), config.sessionDays),
  };
  return { gh, auth };
}

// A Studio with sign-in on, over a throwaway worktree (with `git`, a
// repository on a change request branch), GitHub faked. `signIn` goes
// through the device flow and answers the cookie and csrf token to send.
// `roles` replaces the role reader, to change a role at once.
export async function startAuthStudio({ git = false, config = testAuthConfig(), checkEveryMs, roles }: { git?: boolean; config?: AuthConfig; checkEveryMs?: number; roles?: AuthOptions['roles'] } = {}) {
  const worktree = git ? await makeGitWorktree() : await makeWorktree();
  const home = await mkdtemp(join(tmpdir(), 'notes-studio-home-'));
  const { gh, auth } = fakeAuth(home, config, { checkEveryMs });
  if (roles !== undefined) auth.roles = roles;
  const studio = await startStudioServer({ port: 0, root: worktree.root, auth });
  const port = String((studio.server.address() as AddressInfo).port);
  const origin = `http://127.0.0.1:${port}`;
  const send = sender(origin);

  return {
    ...studio,
    root: worktree.root,
    home,
    port,
    origin,
    gh,
    auth,
    send,
    signIn: (login: string) => signInWith(send, gh, login),
    close: async () => {
      await studio.close();
      await auth.sessions.saved();
      await worktree.remove();
      await rm(home, { recursive: true, force: true });
    },
  };
}

export type AuthStudio = Awaited<ReturnType<typeof startAuthStudio>>;
