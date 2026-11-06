import { describe, expect, it } from 'vitest';
import { NOW, type PageHistory } from '#api/history.ts';
import { comparedWith, restoreBlocked, shortVersion, versionIds } from '#history/versions.ts';

const sha = (digit: string) => digit.repeat(40);
const history = (mtimeMs: number | null): PageHistory => ({
  path: 'content/docs/a.mdx',
  mtimeMs,
  deleted: null,
  versions: [sha('c'), sha('b'), sha('a')].map((each) => ({ sha: each, date: '2026-10-01T10:00:00Z', author: 'A', message: 'm', path: 'content/docs/a.mdx', status: 'M' as const, inChangeRequest: false })),
});

describe('page versions', () => {
  it('lists Now first only where the page can be edited and is still there', () => {
    expect(versionIds(history(1), true)).toEqual([NOW, sha('c'), sha('b'), sha('a')]);
    expect(versionIds(history(1), false)).toEqual([sha('c'), sha('b'), sha('a')]);
    expect(versionIds(history(null), true)).toEqual([sha('c'), sha('b'), sha('a')]);
  });

  it('compares with the version before by default, or the one picked', () => {
    const ids = [NOW, sha('c'), sha('b'), sha('a')];
    expect(comparedWith(ids, NOW, null)).toBe(sha('c'));
    expect(comparedWith(ids, sha('b'), null)).toBe(sha('a'));
    expect(comparedWith(ids, sha('a'), null)).toBeNull();
    expect(comparedWith(ids, sha('a'), NOW)).toBe(NOW);
    // Itself, or a version no longer listed, falls back to the one before.
    expect(comparedWith(ids, sha('c'), sha('c'))).toBe(sha('b'));
    expect(comparedWith(ids, sha('c'), sha('f'))).toBe(sha('b'));
  });

  it('says why Restore is off', () => {
    expect(restoreBlocked({ selected: sha('a'), readOnly: false, mtimeMs: 1 })).toBeNull();
    expect(restoreBlocked({ selected: sha('a'), readOnly: true, mtimeMs: 1 })).toMatch(/read only/);
    // A reader on a change request has no Edit to turn to (#99).
    expect(restoreBlocked({ selected: sha('a'), readOnly: false, reader: true, mtimeMs: 1 })).toBe('Restoring needs write access to the repository; you are signed in as a reader.');
    expect(restoreBlocked({ selected: NOW, readOnly: false, mtimeMs: 1 })).toMatch(/older version/);
    // A deleted page comes back whole; a deleted asset does not.
    expect(restoreBlocked({ selected: sha('a'), readOnly: false, mtimeMs: null })).toBeNull();
    expect(restoreBlocked({ selected: sha('a'), readOnly: false, mtimeMs: null, asset: true })).toMatch(/not in this change request/);
    expect(shortVersion(NOW)).toBe('Now');
    expect(shortVersion(sha('a'))).toBe('aaaaaaa');
  });
});
