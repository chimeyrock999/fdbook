// What the server and the page both need to know about sign-in. No Node
// imports: the UI reads this module too (src/api/session.ts, src/session).

// How people sign in: a code typed on github.com (device), or a redirect to
// GitHub and back (web). The first one is the sign-in page's main button.
export type SignInFlow = 'device' | 'web';

// What a signed-in person may do, from their access to the repository:
// read (`read`, `triage`), write (`write`, `maintain`) or also clean up
// what is on origin (`admin`). `none` is refused after sign-in.
export type Role = 'none' | 'reader' | 'writer' | 'admin';

const RANK: Record<Role, number> = { none: 0, reader: 1, writer: 2, admin: 3 };

export const atLeast = (role: Role, needed: Role) => RANK[role] >= RANK[needed];

// The header every write must carry, with the session's csrf token.
export const CSRF_HEADER = 'x-studio-csrf';

// What GET /api/session answers: whether sign-in is on, how to sign in, and
// who is signed in with their role.
export type SessionState = {
  auth: 'github' | 'off';
  flows: SignInFlow[];
  repo: string | null;
  user: { login: string; name: string | null; avatarUrl: string } | null;
  role: Role | null;
  csrf: string | null;
};

// Sign-in off: no user, every right.
export const SESSION_OFF: SessionState = { auth: 'off', flows: [], repo: null, user: null, role: 'admin', csrf: null };

// Whether discarding a change request touches origin: its branch is there
// (it goes too) or its pull request is open (it is closed). Only an admin
// may do that (server/cr/manager.ts).
export const touchesOrigin = ({ pushed, status }: { pushed: boolean; status: string }) => pushed || status === 'review';
