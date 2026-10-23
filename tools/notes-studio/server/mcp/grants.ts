import { createHash, randomBytes } from 'node:crypto';
import type { AgentRole } from '../agents/shared.ts';

// What an agent run may do through the Studio's MCP server: its change
// request and its role, nothing else.
export type RunGrant = { slug: string; runId: string; agent: string; role: AgentRole };

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

// The bearer tokens of the agent runs going on, one per run: made when the
// run starts and dropped when it ends, so a token an agent kept is no use
// afterwards. Only their hashes are kept.
export function createRunGrants() {
  const grants = new Map<string, RunGrant>();
  return {
    issue(grant: RunGrant) {
      const token = `studio-run-${randomBytes(24).toString('base64url')}`;
      grants.set(hashOf(token), grant);
      return { token, revoke: () => { grants.delete(hashOf(token)); } };
    },
    resolve: (token: string) => grants.get(hashOf(token)) ?? null,
  };
}

export type RunGrants = ReturnType<typeof createRunGrants>;
