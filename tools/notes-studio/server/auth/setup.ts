import { join } from 'node:path';
import type { AuthOptions } from './auth.ts';
import { parseAuthConfig } from './config.ts';
import { createGitHub } from './github.ts';
import { createRoleReader, ghRepoAccess } from './roles.ts';
import { createSessionStore } from './sessions.ts';

// Sign-in as the environment sets it up for a Studio bound to `host`, or
// null when it is off (see config.ts). Sessions live in the Studio home,
// one file a port: Studios on one machine share the home.
export function githubAuth(host: string, port: number, repo: string, home: string): AuthOptions | null {
  const config = parseAuthConfig(host);
  if (config === null) return null;
  const access = ghRepoAccess(repo);
  return {
    config,
    github: createGitHub(config),
    repo: access,
    roles: createRoleReader(access.permission, config.allowedUsers),
    sessions: createSessionStore(join(home, `sessions-${String(port)}.json`), config.sessionDays),
  };
}
