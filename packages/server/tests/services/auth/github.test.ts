import { describe, expect, it } from 'vitest';
import { createGitHub } from '#services/auth/github.ts';

// A fetch that answers each call with the next body and records the requests.
function fakeFetch(...answers: { status?: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const answer = answers.shift() ?? { status: 500, body: {} };
    return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'Content-Type': 'application/json' } }));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const config = { clientId: 'cid', clientSecret: 'secret' };

describe('GitHub sign-in calls', () => {
  it('asks for a device code with no scope', async () => {
    const { calls, fetchImpl } = fakeFetch({ body: { device_code: 'dc', user_code: 'AB-CD', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 } });
    expect(await createGitHub(config, fetchImpl).deviceCode()).toEqual({ deviceCode: 'dc', userCode: 'AB-CD', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5 });
    expect(calls[0]?.url).toBe('https://github.com/login/device/code');
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ client_id: 'cid', scope: '' });
  });

  it('says what to check when GitHub does not know the app', async () => {
    const { fetchImpl } = fakeFetch({ status: 404, body: {} });
    await expect(createGitHub(config, fetchImpl).deviceCode()).rejects.toThrow('GitHub answered 404 to /login/device/code: check STUDIO_GITHUB_CLIENT_ID and that the OAuth App has Device Flow enabled.');
  });

  it('reads each answer of a device poll', async () => {
    const { fetchImpl } = fakeFetch(
      { body: { error: 'authorization_pending' } },
      { body: { error: 'slow_down', interval: 10 } },
      { body: { access_token: 'tok' } },
      { body: { error: 'expired_token' } },
      { body: { error: 'access_denied' } },
      { body: { error: 'incorrect_client_credentials', error_description: 'The client_id is wrong.' } },
    );
    const github = createGitHub(config, fetchImpl);
    expect(await github.pollDevice('dc')).toEqual({ state: 'pending', interval: null });
    expect(await github.pollDevice('dc')).toEqual({ state: 'pending', interval: 10 });
    expect(await github.pollDevice('dc')).toEqual({ state: 'done', token: 'tok' });
    expect(await github.pollDevice('dc')).toEqual({ state: 'expired' });
    expect(await github.pollDevice('dc')).toEqual({ state: 'denied' });
    await expect(github.pollDevice('dc')).rejects.toThrow('GitHub refused the sign-in: The client_id is wrong.');
  });

  it('builds the authorize link and exchanges the code with the secret', async () => {
    const { calls, fetchImpl } = fakeFetch({ body: { access_token: 'tok' } }, { body: { error: 'bad_verification_code' } });
    const github = createGitHub(config, fetchImpl);
    const url = new URL(github.authorizeUrl('http://100.1.2.3:4310/api/session/callback', 'st'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: 'cid', redirect_uri: 'http://100.1.2.3:4310/api/session/callback', state: 'st', scope: '', allow_signup: 'false' });
    expect(await github.exchangeCode('code', 'http://x/cb')).toBe('tok');
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ client_id: 'cid', client_secret: 'secret', code: 'code', redirect_uri: 'http://x/cb' });
    await expect(github.exchangeCode('code', 'http://x/cb')).rejects.toThrow(/bad_verification_code/);
  });

  it('reads the user with the token', async () => {
    const { calls, fetchImpl } = fakeFetch({ body: { id: 7, login: 'alice', name: null, avatar_url: 'https://a/7' } }, { status: 401, body: {} });
    const github = createGitHub(config, fetchImpl);
    expect(await github.user('tok')).toEqual({ id: 7, login: 'alice', name: null, avatarUrl: 'https://a/7' });
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer tok');
    await expect(github.user('tok')).rejects.toThrow(/401/);
  });
});
