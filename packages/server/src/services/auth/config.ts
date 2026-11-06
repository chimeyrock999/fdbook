import { DEFAULT_STUDIO_HOST } from '#infra/config/config.ts';
import type { SignInFlow } from '@fdbook/shared/auth.ts';

export type AuthConfig = {
  clientId: string;
  // Only the web flow needs it.
  clientSecret: string | null;
  flows: SignInFlow[];
  // GitHub logins, lowercase; empty lets in anyone with access to the repository.
  allowedUsers: string[];
  sessionDays: number;
};

export const DEFAULT_SESSION_DAYS = 7;

type Env = Record<string, string | undefined>;

const valueOf = (env: Env, name: string) => {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? null : value;
};

function parseFlows(value: string | null): SignInFlow[] {
  if (value === null) return ['device'];
  const flows = value.split(',').map((flow) => flow.trim());
  if (flows.some((flow) => flow !== 'device' && flow !== 'web') || new Set(flows).size !== flows.length) {
    throw new Error(`STUDIO_GITHUB_FLOWS must be device, web, or both separated by a comma, got "${value}".`);
  }
  return flows as SignInFlow[];
}

function parseSessionDays(value: string | null) {
  if (value === null) return DEFAULT_SESSION_DAYS;
  const days = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(days) || days < 1) throw new Error(`STUDIO_SESSION_DAYS must be a whole number of days, 1 or more, got "${value}".`);
  return days;
}

// The sign-in settings, or null when sign-in is off. STUDIO_AUTH is
// `github` or `off`; unset, it is off on 127.0.0.1 (one person, one machine)
// and on everywhere else, where `off` is refused: anyone who can reach that
// address could edit, commit and publish.
export function parseAuthConfig(host: string, env: Env = process.env): AuthConfig | null {
  const mode = valueOf(env, 'STUDIO_AUTH');
  const loopback = host === DEFAULT_STUDIO_HOST;
  if (mode !== null && mode !== 'github' && mode !== 'off') throw new Error(`STUDIO_AUTH must be github or off, got "${mode}".`);
  if (mode === 'off' && !loopback) throw new Error(`STUDIO_AUTH=off is only allowed on ${DEFAULT_STUDIO_HOST}: on ${host} anyone who reaches the Studio could edit and publish.`);
  if ((mode ?? (loopback ? 'off' : 'github')) === 'off') return null;
  const clientId = valueOf(env, 'STUDIO_GITHUB_CLIENT_ID');
  if (clientId === null) throw new Error('Sign-in with GitHub needs STUDIO_GITHUB_CLIENT_ID, the client ID of a GitHub OAuth App (see studio/docs/setup.md).');
  const flows = parseFlows(valueOf(env, 'STUDIO_GITHUB_FLOWS'));
  const clientSecret = valueOf(env, 'STUDIO_GITHUB_CLIENT_SECRET');
  if (flows.includes('web') && clientSecret === null) throw new Error('STUDIO_GITHUB_FLOWS includes web, which needs STUDIO_GITHUB_CLIENT_SECRET.');
  const allowedUsers = (valueOf(env, 'STUDIO_ALLOWED_USERS') ?? '').split(',').map((login) => login.trim().toLowerCase()).filter((login) => login !== '');
  return { clientId, clientSecret, flows, allowedUsers, sessionDays: parseSessionDays(valueOf(env, 'STUDIO_SESSION_DAYS')) };
}

// Where GitHub sends the web flow back to; the OAuth App's callback URL must be this.
export const CALLBACK_PATH = '/api/session/callback';
