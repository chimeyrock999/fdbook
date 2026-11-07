import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionStore } from '#services/auth/sessions.ts';

const alice = { id: 1, login: 'alice', name: 'Alice', avatarUrl: 'https://avatars.example/alice' };

describe('session store', () => {
  let home: string;
  let file: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'studio-sessions-'));
    file = join(home, 'nested/sessions.json');
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(home, { recursive: true, force: true });
  });

  it('keeps sessions by the hash of their id, in a file only its owner reads', async () => {
    const store = createSessionStore(file, 7);
    const { id, session } = await store.create(alice);
    expect(store.get(id)).toEqual(session);
    expect(store.get('another')).toBeNull();
    expect(store.get(null)).toBeNull();
    const text = await readFile(file, 'utf8');
    expect(text).not.toContain(id);
    expect(text).toContain('alice');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('keeps them across a restart, and forgets one signed out', async () => {
    const first = createSessionStore(file, 7);
    const { id, session } = await first.create(alice);
    const second = createSessionStore(file, 7);
    expect(second.get(id)).toEqual(session);
    await second.remove(id);
    expect(createSessionStore(file, 7).get(id)).toBeNull();
  });

  it('lets a session expire after its days', async () => {
    vi.useFakeTimers();
    const store = createSessionStore(file, 2);
    const { id } = await store.create(alice);
    vi.advanceTimersByTime(2 * 24 * 3600_000 - 1);
    expect(store.get(id)).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(store.get(id)).toBeNull();
  });

  it('starts empty from a file it cannot read', () => {
    const store = createSessionStore(join(home, 'missing.json'), 7);
    expect(store.get('x')).toBeNull();
  });
});
