import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { driftedPackages } from '../../server/deps';

describe('installed packages against the lockfile', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  // A throwaway package: package.json asks for `wants`, package-lock.json
  // pins `locked`, node_modules holds `installed` (null: nothing).
  async function checkout(packages: Record<string, { locked: string; installed: string | null; dev?: boolean }>) {
    const dir = await mkdtemp(join(tmpdir(), 'studio-deps-'));
    dirs.push(dir);
    const manifest = { dependencies: {} as Record<string, string>, devDependencies: {} as Record<string, string> };
    const lock: Record<string, { version: string }> = { '': { version: '0.0.0' } };
    for (const [name, { locked, installed, dev }] of Object.entries(packages)) {
      (dev ? manifest.devDependencies : manifest.dependencies)[name] = `^${locked}`;
      lock[`node_modules/${name}`] = { version: locked };
      if (installed !== null) {
        await mkdir(join(dir, 'node_modules', name), { recursive: true });
        await writeFile(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: installed }));
      }
    }
    await writeFile(join(dir, 'package.json'), JSON.stringify(manifest));
    await writeFile(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: lock }));
    return dir;
  }

  it('names packages a pull changed without a reinstall, either way', async () => {
    // The checkout that opened every folder at once: fumadocs-core 16.8.11 after #40.
    const dir = await checkout({
      'fumadocs-core': { locked: '16.17.7', installed: '16.8.11' },
      zod: { locked: '4.1.0', installed: '4.1.0' },
      vite: { locked: '8.3.4', installed: null, dev: true },
      '@scope/pkg': { locked: '1.0.0', installed: '1.0.1' },
    });
    expect(driftedPackages(dir)).toEqual([
      'fumadocs-core 16.8.11 (lockfile 16.17.7)',
      '@scope/pkg 1.0.1 (lockfile 1.0.0)',
      'vite missing (lockfile 8.3.4)',
    ]);
  });

  it('passes a matching install, and a package without a lockfile', async () => {
    expect(driftedPackages(await checkout({ zod: { locked: '4.1.0', installed: '4.1.0' } }))).toEqual([]);
    const bare = await mkdtemp(join(tmpdir(), 'studio-deps-'));
    dirs.push(bare);
    expect(driftedPackages(bare)).toEqual([]);
  });
});
