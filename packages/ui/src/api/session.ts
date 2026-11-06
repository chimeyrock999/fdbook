// Client for sign-in (server/services/auth/auth.ts), and the fetch every other
// client goes through: it adds the session's csrf token to each write and
// tells the page when the server answers that nobody is signed in.

import { CSRF_HEADER, type Role, type SessionState } from '@fdbook/shared/auth.ts';
import { errorOf, readJson } from './json';

export type { Role, SessionState };

export type DeviceStart = { flow: string; userCode: string; verificationUri: string; expiresIn: number; interval: number };
// `error`: why the last poll failed on the server's side (GitHub or gh
// down); the code still stands, so polling goes on.
export type DevicePoll = { state: 'pending'; interval: number | null; error?: string } | { state: 'done'; session: SessionState };

const READS = new Set(['GET', 'HEAD']);

let csrf: string | null = null;
const signedOut = new Set<() => void>();

// The token later writes carry; null when sign-in is off or nobody is in.
export function setCsrf(token: string | null) {
  csrf = token;
}

// Called when a request answers 401: the session is gone (expired, signed
// out in another tab) and the page should ask to sign in again.
export function onSignedOut(listener: () => void) {
  signedOut.add(listener);
  return () => { signedOut.delete(listener); };
}

const back = new Set<() => void>();

// Called when the Studio is signed in again after its session ended (the
// sign-in over it is gone): what waited for the session goes on.
export function onSessionBack(listener: () => void) {
  back.add(listener);
  return () => { back.delete(listener); };
}

export function sessionBack() {
  for (const listener of [...back]) listener();
}

export async function studioFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (csrf !== null && !READS.has(method)) headers.set(CSRF_HEADER, csrf);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) for (const listener of [...signedOut]) listener();
  return response;
}

let confirming: Promise<void> | null = null;

// After something that cannot see a 401 (a sync socket the server closed,
// whose reconnects it refuses): asks who is signed in, and tells the page
// when nobody is, or their access was taken away. A server that does not
// answer says nothing either way. Editors going offline together ask once.
export function confirmSignedIn() {
  confirming ??= (async () => {
    const response = await fetch('/api/session').catch(() => null);
    if (response?.ok !== true) return;
    const state = await readJson<SessionState>(response).catch(() => null);
    if (state?.auth === 'github' && (state.user === null || state.role === 'none')) for (const listener of [...signedOut]) listener();
  })().finally(() => { confirming = null; });
  return confirming;
}

let seatCheck: (() => Promise<boolean>) | null = null;

// Set by the session gate: whether the session the browser holds now is the
// one the Studio runs with (src/app/SessionGate.tsx). Null when nothing
// is set.
export function onSeatCheck(check: (() => Promise<boolean>) | null) {
  seatCheck = check;
}

// The notes sync's `auth` hook, asked on every connection, reconnects
// included: a reconnect carries the cookie the browser holds now, which
// another tab may have changed to another person's (#121). Refusing closes
// that connection, so an open note's unsaved edits never save under another
// account; the gate then mounts the Studio afresh for them.
export async function checkSeat() {
  if (seatCheck !== null && !(await seatCheck())) throw new Error('The Studio is signed in as someone else now.');
}

const postJson = (path: string, body: unknown) =>
  studioFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function createSessionClient(base = '') {
  return {
    async load(): Promise<SessionState> {
      const response = await fetch(`${base}/api/session`);
      if (!response.ok) throw await errorOf(response);
      return readJson<SessionState>(response);
    },
    async startDevice(): Promise<DeviceStart> {
      const response = await postJson(`${base}/api/session/device`, {});
      if (!response.ok) throw await errorOf(response);
      return readJson<DeviceStart>(response);
    },
    async pollDevice(flow: string): Promise<DevicePoll> {
      const response = await postJson(`${base}/api/session/device/poll`, { flow });
      if (response.status >= 500) return { state: 'pending', interval: null, error: (await errorOf(response)).message };
      if (!response.ok) throw await errorOf(response);
      return readJson<DevicePoll>(response);
    },
    // A page load, not a fetch: the server sends the browser on to GitHub.
    webUrl: `${base}/api/session/web`,
    async logout(): Promise<SessionState> {
      const response = await postJson(`${base}/api/session/logout`, {});
      if (!response.ok) throw await errorOf(response);
      return readJson<SessionState>(response);
    },
  };
}

export type SessionClient = ReturnType<typeof createSessionClient>;
