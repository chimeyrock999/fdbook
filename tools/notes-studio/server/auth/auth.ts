import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, pathnameOf, readJsonObject, sendJson } from '../http.ts';
import { requiredRole, setViewer, type Viewer } from '../security/access.ts';
import { CALLBACK_PATH, type AuthConfig } from './config.ts';
import type { GitHub, GitHubUser } from './github.ts';
import type { RepoAccess, RoleReader } from './roles.ts';
import type { Session, SessionStore } from './sessions.ts';
import { atLeast, CSRF_HEADER, SESSION_OFF, type Role, type SessionState } from './shared.ts';

const MAX_BODY_BYTES = 1024;
// Sign-ins started and not finished: a device code lives 15 minutes, a web
// redirect 10. Bounded, so nobody can fill the memory by starting them.
const MAX_PENDING = 200;
const WEB_STATE_MS = 10 * 60_000;
// How often the viewers of open sockets are checked for an expired session
// or a role taken away. A sign-out ends them at once.
const CHECK_EVERY_MS = 15_000;

export type AuthOptions = {
  config: AuthConfig;
  github: GitHub;
  repo: RepoAccess;
  roles: RoleReader;
  sessions: SessionStore;
  checkEveryMs?: number | undefined;
};

function cookiesOf(request: IncomingMessage) {
  const cookies = new Map<string, string>();
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) cookies.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return cookies;
}

function sameToken(a: string, b: string) {
  const [left, right] = [Buffer.from(a), Buffer.from(b)];
  return left.length === right.length && timingSafeEqual(left, right);
}

function redirect(response: ServerResponse, location: string, cookies: string[] = []) {
  response.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...(cookies.length > 0 ? { 'Set-Cookie': cookies } : {}) });
  response.end();
}

// The sign-in gate of one Studio, or with `null` a gate that lets everything
// through (sign-in off). Cookie names carry the port: browsers share
// cookies between ports of one host, and two Studios must not sign each
// other out. `host` is the Host the web flow comes back to (the OAuth
// App's one callback URL); a web sign-in started on another one (localhost
// for 127.0.0.1) starts again there, so its cookies land on that host.
export function createAuth(options: AuthOptions | null, port: number, host = `127.0.0.1:${String(port)}`) {
  const sessionCookie = `studio_session_${String(port)}`;
  const stateCookie = `studio_oauth_${String(port)}`;

  if (options === null) {
    return {
      enabled: false,
      gate: (request: IncomingMessage, response: ServerResponse) => {
        if (pathnameOf(request) !== '/api/session') return Promise.resolve(false);
        if (request.method === 'GET') sendJson(response, 200, SESSION_OFF);
        else sendJson(response, 405, { error: 'sign-in is off in this Studio' });
        return Promise.resolve(true);
      },
      gateUpgrade: (() => Promise.resolve(null)) as (request: IncomingMessage, needed: Role) => Promise<number | null>,
      // Agent tokens are for a Studio with sign-in: without it an agent on
      // this machine needs none, like any other client.
      issueAgentToken: (() => Promise.reject(new HttpError(409, 'Sign-in is off in this Studio: agents need no token.'))) as (request: IncomingMessage) => Promise<string>,
      clearAgentTokens: (() => Promise.reject(new HttpError(409, 'Sign-in is off in this Studio: agents need no token.'))) as (request: IncomingMessage) => Promise<void>,
      viewerOfAgentToken: (() => Promise.resolve(null)) as (token: string) => Promise<Viewer | null>,
    };
  }
  const { config, github, repo, roles, sessions, checkEveryMs = CHECK_EVERY_MS } = options;
  // A device code GitHub has confirmed keeps its token until sign-in is done,
  // so a failure after it (gh offline for the role) can be retried.
  const devices = new Map<string, { deviceCode: string; expiresAt: number; token?: string }>();
  const webStates = new Map<string, number>();

  const prune = () => {
    const now = Date.now();
    for (const [id, flow] of devices) if (flow.expiresAt <= now) devices.delete(id);
    for (const [state, expiresAt] of webStates) if (expiresAt <= now) webStates.delete(state);
    if (devices.size + webStates.size >= MAX_PENDING) throw new HttpError(429, 'Too many sign-ins in progress. Try again in a few minutes.');
  };

  const sessionId = (request: IncomingMessage) => cookiesOf(request).get(sessionCookie) ?? null;
  const sessionCookieOf = (id: string) => `${sessionCookie}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${String(sessions.maxAgeSeconds)}`;
  const clearSession = `${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

  const repoName = () => repo.name().catch(() => null);

  // Viewers watched for their end (Viewer.watch), by the session id they
  // came with. Checked on a timer while there are any.
  type Watched = { id: string; current: () => Role; onLost: () => void };
  const watched = new Set<Watched>();
  let checking: NodeJS.Timeout | null = null;
  const unwatch = (entry: Watched) => {
    watched.delete(entry);
    if (watched.size === 0 && checking !== null) {
      clearInterval(checking);
      checking = null;
    }
  };
  const lose = (entry: Watched) => {
    unwatch(entry);
    entry.onLost();
  };
  // A viewer already lost (signed out between the gate and the upgrade) ends at once.
  const watch = (entry: Watched) => {
    if (!atLeast(entry.current(), 'reader')) {
      entry.onLost();
      return () => undefined;
    }
    watched.add(entry);
    if (checking === null) {
      checking = setInterval(() => {
        for (const each of [...watched]) if (!atLeast(each.current(), 'reader')) lose(each);
      }, checkEveryMs);
      checking.unref();
    }
    return () => { unwatch(entry); };
  };

  async function stateOf(session: Session | null): Promise<SessionState> {
    const base = { auth: 'github' as const, flows: config.flows, repo: await repoName() };
    if (session === null) return { ...base, user: null, role: null, csrf: null };
    const { login, name, avatarUrl } = session.user;
    const role = await roles(login).catch((error: unknown) => {
      throw new HttpError(503, `Could not read your access to the repository: ${(error as Error).message}`);
    });
    return { ...base, user: { login, name, avatarUrl }, role, csrf: session.csrf };
  }

  // Signs in a GitHub user, if they have access: answers the session and its
  // cookie, or throws 403 naming who was refused.
  async function signIn(user: GitHubUser) {
    const role = await roles(user.login, true);
    if (role === 'none') {
      const where = (await repoName()) ?? 'this repository';
      const reason = config.allowedUsers.length > 0 && !config.allowedUsers.includes(user.login.toLowerCase()) ? 'is not in STUDIO_ALLOWED_USERS' : `has no access to ${where}`;
      throw new HttpError(403, `@${user.login} ${reason}.`);
    }
    const { id, session } = await sessions.create(user);
    return { cookie: sessionCookieOf(id), state: await stateOf(session) };
  }

  async function sessionApi(request: IncomingMessage, response: ServerResponse, pathname: string) {
    const method = request.method ?? 'GET';
    if (pathname === '/api/session' && method === 'GET') {
      sendJson(response, 200, await stateOf(sessions.get(sessionId(request))));
      return;
    }
    if (pathname === '/api/session/device' && method === 'POST' && config.flows.includes('device')) {
      await readJsonObject(request, MAX_BODY_BYTES, 'a sign-in');
      prune();
      const code = await github.deviceCode();
      const flow = randomBytes(16).toString('base64url');
      devices.set(flow, { deviceCode: code.deviceCode, expiresAt: Date.now() + code.expiresIn * 1000 });
      sendJson(response, 200, { flow, userCode: code.userCode, verificationUri: code.verificationUri, expiresIn: code.expiresIn, interval: code.interval });
      return;
    }
    if (pathname === '/api/session/device/poll' && method === 'POST' && config.flows.includes('device')) {
      const { flow } = await readJsonObject(request, MAX_BODY_BYTES, 'a sign-in');
      const pending = typeof flow === 'string' ? devices.get(flow) : undefined;
      if (pending === undefined || pending.expiresAt <= Date.now()) throw new HttpError(410, 'The code expired. Start again.');
      const poll = pending.token === undefined ? await github.pollDevice(pending.deviceCode) : { state: 'done' as const, token: pending.token };
      if (poll.state === 'pending') {
        sendJson(response, 200, { state: 'pending', interval: poll.interval });
        return;
      }
      if (poll.state !== 'done') devices.delete(flow as string);
      if (poll.state === 'expired') throw new HttpError(410, 'The code expired. Start again.');
      if (poll.state === 'denied') throw new HttpError(403, 'The sign-in was cancelled on GitHub.');
      pending.token = poll.token;
      let signedIn;
      try {
        signedIn = await signIn(await github.user(poll.token));
      } catch (error) {
        // Refused for good (no access): the code is used up. Anything else can be polled again.
        if (error instanceof HttpError && error.status === 403) devices.delete(flow as string);
        throw error;
      }
      devices.delete(flow as string);
      const { cookie, state } = signedIn;
      response.setHeader('Set-Cookie', cookie);
      sendJson(response, 200, { state: 'done', session: state });
      return;
    }
    if (pathname === '/api/session/web' && method === 'GET' && config.flows.includes('web')) {
      if (request.headers.host !== host) {
        redirect(response, `http://${host}/api/session/web`);
        return;
      }
      prune();
      const state = randomBytes(24).toString('base64url');
      webStates.set(state, Date.now() + WEB_STATE_MS);
      const callback = `http://${host}${CALLBACK_PATH}`;
      // Lax: GitHub's redirect back is a cross-site navigation, which a Strict cookie would miss.
      redirect(response, github.authorizeUrl(callback, state), [`${stateCookie}=${state}; Path=/api/session; HttpOnly; SameSite=Lax; Max-Age=${String(WEB_STATE_MS / 1000)}`]);
      return;
    }
    if (pathname === CALLBACK_PATH && method === 'GET' && config.flows.includes('web')) {
      const clearState = `${stateCookie}=; Path=/api/session; HttpOnly; SameSite=Lax; Max-Age=0`;
      const failed = (message: string) => {
        redirect(response, `/?signin_error=${encodeURIComponent(message)}`, [clearState]);
      };
      const query = new URL(request.url ?? '/', 'http://studio').searchParams;
      const state = query.get('state') ?? '';
      const expected = cookiesOf(request).get(stateCookie) ?? '';
      const expiresAt = webStates.get(state);
      webStates.delete(state);
      if (state === '' || !sameToken(state, expected) || expiresAt === undefined || expiresAt <= Date.now()) {
        failed('The sign-in link expired or came from another browser. Sign in again.');
        return;
      }
      if (query.get('error') !== null || query.get('code') === null) {
        failed('The sign-in was cancelled on GitHub.');
        return;
      }
      try {
        const token = await github.exchangeCode(query.get('code') ?? '', `http://${host}${CALLBACK_PATH}`);
        const { cookie } = await signIn(await github.user(token));
        redirect(response, '/', [cookie, clearState]);
      } catch (error) {
        failed((error as Error).message);
      }
      return;
    }
    if (pathname === '/api/session/logout' && method === 'POST') {
      const id = sessionId(request);
      const session = sessions.get(id);
      if (session !== null && !sameToken(String(request.headers[CSRF_HEADER] ?? ''), session.csrf)) throw new HttpError(403, 'missing or wrong csrf token');
      await sessions.remove(id);
      for (const entry of [...watched]) if (entry.id === id) lose(entry);
      response.setHeader('Set-Cookie', clearSession);
      sendJson(response, 200, await stateOf(null));
      return;
    }
    throw new HttpError(404, `no such Studio API: ${pathname}`);
  }

  // Who the request is from and whether they may make it: null when they
  // may (and the viewer is recorded for the handlers), else the refusal.
  // What needs nobody (the page, Vite's modules and socket) is not looked at.
  async function check(request: IncomingMessage, needed: Role, write: boolean): Promise<{ status: number; error: string } | null> {
    if (needed === 'none') return null;
    const id = sessionId(request);
    const session = sessions.get(id);
    if (id === null || session === null) return { status: 401, error: 'Sign in to use the Studio.' };
    let role: Role;
    try {
      role = await roles(session.user.login);
    } catch (error) {
      return { status: 503, error: `Could not read your access to the repository: ${(error as Error).message}` };
    }
    const { login } = session.user;
    const current = () => (sessions.get(id) === null ? 'none' : (roles.peek(login) ?? role));
    const viewer: Viewer = { user: session.user, role, current, watch: (onLost) => watch({ id, current, onLost }) };
    setViewer(request, viewer);
    if (!atLeast(role, needed)) {
      return { status: 403, error: role === 'none' ? `@${session.user.login} has no access to this repository.` : `This needs ${needed} access; @${session.user.login} is a ${role}.` };
    }
    if (write && !sameToken(String(request.headers[CSRF_HEADER] ?? ''), session.csrf)) return { status: 403, error: 'missing or wrong csrf token' };
    return null;
  }

  return {
    enabled: true,
    // A bearer token for the signed-in person's own agents (the Studio's MCP
    // server, mcp/http.ts): it acts as them, with their role read as for a
    // session, and ends with their session or when they clear it.
    async issueAgentToken(request: IncomingMessage) {
      const token = await sessions.addAgentToken(sessionId(request));
      if (token === null) throw new HttpError(401, 'Sign in to use the Studio.');
      return token;
    },
    async clearAgentTokens(request: IncomingMessage) {
      await sessions.clearAgentTokens(sessionId(request));
    },
    // Who an agent token acts for, or null when it is no token (any more).
    // Throws when their role cannot be read, as a request would answer 503.
    async viewerOfAgentToken(token: string): Promise<Viewer | null> {
      const session = sessions.byAgentToken(token);
      if (session === null) return null;
      const { login } = session.user;
      const role = await roles(login);
      const current = () => (sessions.byAgentToken(token) === null ? 'none' : (roles.peek(login) ?? role));
      return { user: session.user, role, current, watch: (onLost) => watch({ id: '', current, onLost }) };
    },
    // After the Host/Origin guard: answers the sign-in API itself, refuses
    // what the session may not do, and returns false to pass the rest on.
    async gate(request: IncomingMessage, response: ServerResponse) {
      const pathname = pathnameOf(request);
      const method = request.method ?? 'GET';
      if (pathname === '/api/session' || pathname.startsWith('/api/session/')) {
        try {
          await sessionApi(request, response, pathname);
        } catch (error) {
          sendJson(response, error instanceof HttpError ? error.status : 502, { error: (error as Error).message });
        }
        return true;
      }
      const needed = requiredRole(method, pathname);
      const refusal = await check(request, needed, needed !== 'none' && method !== 'GET' && method !== 'HEAD');
      if (refusal === null) return false;
      sendJson(response, refusal.status, { error: refusal.error });
      return true;
    },
    // For a websocket upgrade: the notes sync needs a reader (whether it
    // may write is the sync's to ask, with viewerOf). Others (Vite HMR)
    // carry no notes and need nobody.
    async gateUpgrade(request: IncomingMessage, needed: Role): Promise<number | null> {
      return (await check(request, needed, false))?.status ?? null;
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
