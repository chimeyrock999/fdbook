import { CommandError, run } from '#cr/git.ts';

import type { Role } from '@fdbook/shared/auth.ts';

// GitHub's role name (role_name of the collaborator permission API).
export function roleOf(roleName: string): Role {
  if (roleName === 'admin') return 'admin';
  if (roleName === 'write' || roleName === 'maintain') return 'writer';
  if (roleName === 'read' || roleName === 'triage') return 'reader';
  return 'none';
}

// The repository people sign in to: its owner/name, and the role name of
// a login there (`none` for someone without access).
export type RepoAccess = { name: () => Promise<string>; permission: (login: string) => Promise<string> };

const TIMEOUT_MS = 20_000;

// Asks with the host's gh, which can read the collaborators of a private
// repository; the signed-in person's token would need the `repo` scope.
// GitHub answers 404 for someone who is not a collaborator there.
export function ghRepoAccess(repo: string): RepoAccess {
  let pending: Promise<string> | null = null;
  const name = () => {
    pending ??= run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], repo, { timeoutMs: TIMEOUT_MS }).then(
      (output) => output.trim(),
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );
    return pending;
  };
  return {
    name,
    async permission(login) {
      try {
        const output = await run('gh', ['api', `repos/${await name()}/collaborators/${encodeURIComponent(login)}/permission`, '--jq', '.role_name'], repo, { timeoutMs: TIMEOUT_MS });
        return output.trim();
      } catch (error) {
        if (error instanceof CommandError && error.message.includes('HTTP 404')) return 'none';
        throw error;
      }
    },
  };
}

const CACHE_MS = 5 * 60_000;

// The role of a login: from the repository, read again after CACHE_MS, and
// `none` for anyone outside `allowedUsers` when the list is set. A failed
// read is not cached and not guessed: it throws. Requests that miss the
// cache together share one read. `peek` answers at once, for checks that
// cannot wait (each write on an open sync socket): the role last read, or
// null, reading it again in the background once it is stale.
export function createRoleReader(read: RepoAccess['permission'], allowedUsers: string[]) {
  const cache = new Map<string, { at: number; role: Role }>();
  const reading = new Map<string, Promise<Role>>();
  const allowed = (key: string) => allowedUsers.length === 0 || allowedUsers.includes(key);

  const readNow = (login: string, key: string) => {
    let pending = reading.get(key);
    if (pending === undefined) {
      pending = read(login).then(roleOf).then(
        (role) => {
          cache.set(key, { at: Date.now(), role });
          return role;
        },
      ).finally(() => { reading.delete(key); });
      reading.set(key, pending);
    }
    return pending;
  };

  const roles = (login: string, fresh = false): Promise<Role> => {
    const key = login.toLowerCase();
    if (!allowed(key)) return Promise.resolve('none');
    const cached = cache.get(key);
    if (!fresh && cached !== undefined && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.role);
    return readNow(login, key);
  };

  const peek = (login: string): Role | null => {
    const key = login.toLowerCase();
    if (!allowed(key)) return 'none';
    const cached = cache.get(key);
    if (cached === undefined || Date.now() - cached.at >= CACHE_MS) void readNow(login, key).catch(() => undefined);
    return cached?.role ?? null;
  };

  return Object.assign(roles, { peek });
}

export type RoleReader = ReturnType<typeof createRoleReader>;
