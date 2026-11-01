import type { IncomingMessage } from 'node:http';
import type { GitHubUser } from '../auth/github.ts';
import type { Role } from '../auth/shared.ts';

// The role a request needs, decided from its method and path alone, before
// any handler runs. Reading needs a reader; anything else on /api needs a
// writer, so a new write endpoint is closed until it is listed here. The
// sign-in endpoints and the app itself (the page, Vite) need nobody. A
// change request's API (/cr/<slug>/api/…) is judged like main's.
export function requiredRole(method: string, pathname: string): Role {
  const rest = /^\/cr\/[^/]+(\/.*)$/.exec(pathname)?.[1] ?? pathname;
  if (rest !== '/api' && !rest.startsWith('/api/')) return 'none';
  if (pathname === '/api/session' || pathname.startsWith('/api/session/')) return 'none';
  // The Studio's MCP server takes a bearer token instead of a session
  // (mcp/http.ts), and refuses a request without a good one itself.
  if (pathname === '/api/mcp') return 'none';
  // A token acts with its owner's role, so a reader may make one to read with.
  if (pathname === '/api/mcp/tokens') return 'reader';
  if (method === 'GET' || method === 'HEAD') return 'reader';
  // Linting reads a draft and writes nothing.
  if (method === 'POST' && rest === '/api/lint') return 'reader';
  // Keeping or reverting what a turn changed is an edit like any other.
  if (/^\/api\/agents\/conversations\/[^/]+\/turns\/[^/]+\/changes$/.test(rest)) return 'writer';
  // An agent runs commands as the person who started the Studio, with their
  // logins: starting a chat, sending it a message, answering, stopping and
  // deleting are an admin's.
  if (rest.startsWith('/api/agents/')) return 'admin';
  return 'writer';
}

// Who made a request, once the sign-in gate let it through. `user` is null
// when sign-in is off: then everyone may do everything, as before. `role`
// is what the gate checked; `current()` is the role now, for a websocket
// that outlives the check: `none` once the session is gone, and access taken
// away on GitHub within the role cache's minutes. `watch` calls `onLost`
// once when the viewer falls below `level` (reader by default): at once on
// sign-out, at the next check after the session expired or the role fell
// below it. It answers a function that stops watching.
export type Viewer = { user: GitHubUser | null; role: Role; current: () => Role; watch: (onLost: () => void, level?: Role) => () => void };

const FULL: Viewer = { user: null, role: 'admin', current: () => 'admin', watch: () => () => undefined };
const viewers = new WeakMap<IncomingMessage, Viewer>();

export function setViewer(request: IncomingMessage, viewer: Viewer) {
  viewers.set(request, viewer);
}

// The viewer of a request. One the gate never saw (a handler under test, or
// sign-in off) may do everything: the gate is what refuses.
export const viewerOf = (request: IncomingMessage): Viewer => viewers.get(request) ?? FULL;
