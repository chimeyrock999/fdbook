import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { repoRoot } from '../../server/config';
import { meets, staleRootPackages } from '../../server/deps';

describe('root package versions', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  // A throwaway checkout whose package.json wants `wants` and whose
  // node_modules has `installed` (or nothing).
  async function checkout(wants: string, installed: string | null) {
    const root = await mkdtemp(join(tmpdir(), 'studio-deps-'));
    roots.push(root);
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { 'fumadocs-core': wants } }));
    if (installed !== null) {
      await mkdir(join(root, 'node_modules/fumadocs-core'), { recursive: true });
      await writeFile(join(root, 'node_modules/fumadocs-core/package.json'), JSON.stringify({ version: installed }));
    }
    return root;
  }

  it('reads caret and exact ranges', () => {
    expect(meets('^16.17.7', '16.17.7')).toBe(true);
    expect(meets('^16.17.7', '16.18.0')).toBe(true);
    expect(meets('^16.17.7', '16.8.11')).toBe(false);
    expect(meets('^16.17.7', '16.17.6')).toBe(false);
    expect(meets('^16.17.7', '17.0.0')).toBe(false);
    expect(meets('16.17.7', '16.17.8')).toBe(false);
    expect(meets('latest', '1.0.0')).toBe(true);
  });

  it('names a package installed older than the root asks for: a pull without a reinstall', async () => {
    // The checkout that showed every folder opening at once (#53 on fumadocs-core 16.8.11).
    expect(staleRootPackages(await checkout('^16.17.7', '16.8.11'))).toEqual(['fumadocs-core 16.8.11 (wants ^16.17.7)']);
    expect(staleRootPackages(await checkout('^16.17.7', null))).toEqual(['fumadocs-core missing (wants ^16.17.7)']);
    expect(staleRootPackages(await checkout('^16.17.7', '16.17.7'))).toEqual([]);
  });

  it('passes on this checkout', () => {
    expect(staleRootPackages(repoRoot)).toEqual([]);
  });
});
