import { createHash, randomBytes } from 'node:crypto';
import type { AgentRole } from '@fdbook/shared/agents.ts';

// What an agent run may do through the Studio's MCP server: its change
// request and its role, nothing else. A chat's agent (`runId`: the chat's
// id) holds its token between turns, but it acts only while `active` says
// a turn is going on.
export type RunGrant = { slug: string; runId: string; agent: string; role: AgentRole; active?: () => boolean };

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
    resolve: (token: string) => {
      const grant = grants.get(hashOf(token)) ?? null;
      return grant !== null && (grant.active?.() ?? true) ? grant : null;
    },
  };
}

export type RunGrants = ReturnType<typeof createRunGrants>;
