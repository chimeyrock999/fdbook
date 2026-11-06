import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION_DAYS, parseAuthConfig } from '../../../server/auth/config';

const CLIENT = { STUDIO_GITHUB_CLIENT_ID: 'Iv1.abc' };

describe('parseAuthConfig', () => {
  it('is off on loopback unless STUDIO_AUTH=github', () => {
    expect(parseAuthConfig('127.0.0.1', {})).toBeNull();
    expect(parseAuthConfig('127.0.0.1', { STUDIO_AUTH: 'off' })).toBeNull();
    expect(parseAuthConfig('127.0.0.1', { STUDIO_AUTH: 'github', ...CLIENT })).toMatchObject({ clientId: 'Iv1.abc', flows: ['device'] });
  });

  it('is on everywhere else and refuses to be turned off there', () => {
    expect(parseAuthConfig('100.71.207.12', CLIENT)).toEqual({
      clientId: 'Iv1.abc',
      clientSecret: null,
      flows: ['device'],
      allowedUsers: [],
      sessionDays: DEFAULT_SESSION_DAYS,
    });
    expect(() => parseAuthConfig('100.71.207.12', { STUDIO_AUTH: 'off', ...CLIENT })).toThrow(/only allowed on 127\.0\.0\.1/);
    expect(() => parseAuthConfig('::1', {})).toThrow(/STUDIO_GITHUB_CLIENT_ID/);
  });

  it('refuses an unknown STUDIO_AUTH', () => {
    expect(() => parseAuthConfig('127.0.0.1', { STUDIO_AUTH: 'yes' })).toThrow(/STUDIO_AUTH must be github or off/);
  });

  it('reads the flows in order, and web needs the client secret', () => {
    expect(parseAuthConfig('fd7a::1', { ...CLIENT, STUDIO_GITHUB_FLOWS: ' web , device ', STUDIO_GITHUB_CLIENT_SECRET: 's' })?.flows).toEqual(['web', 'device']);
    expect(() => parseAuthConfig('fd7a::1', { ...CLIENT, STUDIO_GITHUB_FLOWS: 'web' })).toThrow(/STUDIO_GITHUB_CLIENT_SECRET/);
  });

  it.each(['', 'device,device', 'oauth', 'device,', ',web'])('refuses STUDIO_GITHUB_FLOWS=%j when set', (value) => {
    // An empty value is unset: device only.
    if (value === '') expect(parseAuthConfig('fd7a::1', { ...CLIENT, STUDIO_GITHUB_FLOWS: value })?.flows).toEqual(['device']);
    else expect(() => parseAuthConfig('fd7a::1', { ...CLIENT, STUDIO_GITHUB_FLOWS: value })).toThrow(/STUDIO_GITHUB_FLOWS/);
  });

  it('reads the allowed users in lowercase and the session days', () => {
    const config = parseAuthConfig('fd7a::1', { ...CLIENT, STUDIO_ALLOWED_USERS: ' Alice, bob ,,', STUDIO_SESSION_DAYS: '30' });
    expect(config?.allowedUsers).toEqual(['alice', 'bob']);
    expect(config?.sessionDays).toBe(30);
    for (const days of ['0', '1.5', 'week']) {
      expect(() => parseAuthConfig('fd7a::1', { ...CLIENT, STUDIO_SESSION_DAYS: days })).toThrow(/STUDIO_SESSION_DAYS/);
    }
  });
});

describe('githubAuth', () => {
  it('keeps each port\'s sessions in a file of its own in the Studio home', async () => {
    const { githubAuth } = await import('../../../server/auth/setup');
    const { mkdtemp, readdir, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const home = await mkdtemp(join(tmpdir(), 'studio-setup-'));
    const env = { ...process.env };
    try {
      process.env.STUDIO_AUTH = 'github';
      process.env.STUDIO_GITHUB_CLIENT_ID = 'Iv1.abc';
      delete process.env.STUDIO_GITHUB_FLOWS;
      const a = githubAuth('127.0.0.1', 4310, home, home);
      const b = githubAuth('127.0.0.1', 4311, home, home);
      const user = { id: 1, login: 'alice', name: null, avatarUrl: '' };
      await a?.sessions.create(user);
      await b?.sessions.create(user);
      expect((await readdir(home)).sort()).toEqual(['sessions-4310.json', 'sessions-4311.json']);
      expect(githubAuth('127.0.0.1', 4310, home, home)?.sessions).toBeDefined();
    } finally {
      process.env = env;
      await rm(home, { recursive: true, force: true });
    }
  });
});
