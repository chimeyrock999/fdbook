import { createContext, useContext } from 'react';
import type { ChangeRequest } from '#api/crs.ts';
import type { SessionState } from '#api/session.ts';
import { atLeast, SESSION_OFF, touchesOrigin, type Role } from '@fdbook/shared/auth.ts';

// Who uses this page and what they may do. Sign-in off: nobody, every right.
export type SessionValue = { state: SessionState; signOut: () => void };

const OFF: SessionValue = { state: SESSION_OFF, signOut: () => undefined };

export const SessionContext = createContext<SessionValue>(OFF);

export const useSession = () => useContext(SessionContext);

// What the server lets the role do (server/security/access.ts): the UI
// hides the rest, the server is what refuses it.
export function rightsOf(role: Role | null) {
  const has = (needed: Role) => atLeast(role ?? 'none', needed);
  return {
    write: has('writer'),
    // Agents run as the host's user (server/agents): an admin's.
    agents: has('admin'),
    // What is on origin (a pushed branch, an open pull request) needs an admin.
    discard: (cr: ChangeRequest) => has('admin') || (has('writer') && !touchesOrigin(cr)),
  };
}

export const ROLE_LABELS: Record<Role, string> = { none: 'No access', reader: 'Reader', writer: 'Writer', admin: 'Admin' };

export const ADMIN_HINT = 'It is on origin: cleaning it up there needs admin access.';
