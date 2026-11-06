// The GitHub calls of sign-in. The token GitHub gives is used once, to read
// who signed in, and then dropped: the Studio asks for no scope and keeps no
// token. Tests pass their own `fetch`.

export type GitHubUser = { id: number; login: string; name: string | null; avatarUrl: string };

export type DeviceCode = { deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number };

// One poll of a device code: still waiting (with the interval to wait,
// longer after a slow_down), or done with the token, or over.
export type DevicePoll =
  | { state: 'pending'; interval: number | null }
  | { state: 'done'; token: string }
  | { state: 'expired' }
  | { state: 'denied' };

export type GitHub = {
  deviceCode: () => Promise<DeviceCode>;
  pollDevice: (deviceCode: string) => Promise<DevicePoll>;
  authorizeUrl: (redirectUri: string, state: string) => string;
  exchangeCode: (code: string, redirectUri: string) => Promise<string>;
  user: (token: string) => Promise<GitHubUser>;
};

const GITHUB = 'https://github.com';
const API = 'https://api.github.com';
const TIMEOUT_MS = 15_000;

export function createGitHub({ clientId, clientSecret }: { clientId: string; clientSecret: string | null }, fetchImpl: typeof fetch = fetch): GitHub {
  async function post(path: string, body: Record<string, string>) {
    const response = await fetchImpl(`${GITHUB}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`GitHub answered ${String(response.status)} to ${path}`);
    return (await response.json()) as Record<string, unknown>;
  }

  const failure = (answer: Record<string, unknown>) => {
    const reason = [answer.error_description, answer.error].find((value) => typeof value === 'string') ?? 'no token';
    return new Error(`GitHub refused the sign-in: ${reason}`);
  };

  return {
    async deviceCode() {
      // GitHub answers 404 for an unknown client ID, and an error for an App without the device flow.
      const answer = await post('/login/device/code', { client_id: clientId, scope: '' }).catch((error: unknown) => {
        throw new Error(`${(error as Error).message}: check STUDIO_GITHUB_CLIENT_ID and that the OAuth App has Device Flow enabled.`);
      });
      if (typeof answer.device_code !== 'string') throw failure(answer);
      return {
        deviceCode: answer.device_code,
        userCode: String(answer.user_code),
        verificationUri: String(answer.verification_uri),
        expiresIn: Number(answer.expires_in),
        interval: Number(answer.interval),
      };
    },
    async pollDevice(deviceCode) {
      const answer = await post('/login/oauth/access_token', {
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
      if (typeof answer.access_token === 'string') return { state: 'done', token: answer.access_token };
      if (answer.error === 'authorization_pending') return { state: 'pending', interval: null };
      if (answer.error === 'slow_down') return { state: 'pending', interval: Number(answer.interval) || null };
      if (answer.error === 'expired_token') return { state: 'expired' };
      if (answer.error === 'access_denied') return { state: 'denied' };
      throw failure(answer);
    },
    authorizeUrl(redirectUri, state) {
      const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, scope: '', allow_signup: 'false' });
      return `${GITHUB}/login/oauth/authorize?${query.toString()}`;
    },
    async exchangeCode(code, redirectUri) {
      const answer = await post('/login/oauth/access_token', { client_id: clientId, client_secret: clientSecret ?? '', code, redirect_uri: redirectUri });
      if (typeof answer.access_token !== 'string') throw failure(answer);
      return answer.access_token;
    },
    async user(token) {
      const response = await fetchImpl(`${API}/user`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`GitHub answered ${String(response.status)} when reading the signed-in user`);
      const body = (await response.json()) as { id: number; login: string; name: string | null; avatar_url: string };
      return { id: body.id, login: body.login, name: body.name, avatarUrl: body.avatar_url };
    },
  };
}
