import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoleReader, roleOf } from '#auth/roles.ts';
import { atLeast } from '@fdbook/shared/auth.ts';

describe('roles', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['admin', 'admin'],
    ['maintain', 'writer'],
    ['write', 'writer'],
    ['triage', 'reader'],
    ['read', 'reader'],
    ['none', 'none'],
    ['', 'none'],
  ])('maps the role name %j to %s', (name, role) => {
    expect(roleOf(name)).toBe(role);
  });

  it('orders the roles', () => {
    expect(atLeast('admin', 'writer')).toBe(true);
    expect(atLeast('reader', 'writer')).toBe(false);
    expect(atLeast('none', 'none')).toBe(true);
  });

  it('caches a role for five minutes, then reads it again', async () => {
    vi.useFakeTimers();
    let name = 'write';
    const read = vi.fn(() => Promise.resolve(name));
    const roles = createRoleReader(read, []);
    expect(await roles('Alice')).toBe('writer');
    name = 'read';
    expect(await roles('alice')).toBe('writer');
    expect(read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * 60_000);
    expect(await roles('alice')).toBe('reader');
    // `fresh` skips the cache.
    name = 'admin';
    expect(await roles('alice', true)).toBe('admin');
  });

  it('shares one read between requests that miss the cache together', async () => {
    let answer: (name: string) => void = () => undefined;
    const read = vi.fn(() => new Promise<string>((resolve) => { answer = resolve; }));
    const roles = createRoleReader(read, []);
    const all = Promise.all([roles('alice'), roles('Alice'), roles('alice')]);
    answer('write');
    expect(await all).toEqual(['writer', 'writer', 'writer']);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('peeks at the last role at once, reading it again in the background once stale', async () => {
    vi.useFakeTimers();
    let name = 'write';
    const read = vi.fn(() => Promise.resolve(name));
    const roles = createRoleReader(read, ['alice', 'bob']);
    expect(roles.peek('alice')).toBeNull();
    await vi.waitFor(() => { expect(roles.peek('alice')).toBe('writer'); });
    name = 'read';
    vi.advanceTimersByTime(5 * 60_000);
    expect(roles.peek('alice')).toBe('writer');
    await vi.waitFor(() => { expect(roles.peek('alice')).toBe('reader'); });
    expect(roles.peek('carol')).toBe('none');
  });

  it('refuses anyone outside the allowlist without asking GitHub', async () => {
    const read = vi.fn(() => Promise.resolve('admin'));
    const roles = createRoleReader(read, ['alice']);
    expect(await roles('Bob')).toBe('none');
    expect(read).not.toHaveBeenCalled();
    expect(await roles('ALICE')).toBe('admin');
  });

  it('does not cache or guess a failed read', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('gh: not logged in')).mockResolvedValueOnce('read');
    const roles = createRoleReader(read, []);
    await expect(roles('alice')).rejects.toThrow(/not logged in/);
    expect(await roles('alice')).toBe('reader');
  });
});
