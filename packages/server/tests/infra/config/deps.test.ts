import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { driftedPackages, installProblem } from '#infra/config/deps.ts';

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

  it('skips a package linked on purpose with npm link', async () => {
    const dir = await checkout({ 'fumadocs-editor': { locked: '0.3.0', installed: null }, zod: { locked: '4.1.0', installed: '4.0.0' } });
    // npm link: a symlink to a local clone at another version, lockfile untouched.
    const clone = await mkdtemp(join(tmpdir(), 'studio-deps-clone-'));
    dirs.push(clone);
    await writeFile(join(clone, 'package.json'), JSON.stringify({ name: 'fumadocs-editor', version: '0.9.9' }));
    await mkdir(join(dir, 'node_modules'), { recursive: true });
    await symlink(clone, join(dir, 'node_modules', 'fumadocs-editor'), 'dir');
    expect(driftedPackages(dir)).toEqual(['zod 4.0.0 (lockfile 4.1.0)']);
  });

  it('puts the commands first and names at most five packages', async () => {
    const empty = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`pkg-${String(i)}`, { locked: '1.0.0', installed: null }]));
    const root = await checkout(empty);
    const studio = await checkout({ vite: { locked: '8.3.4', installed: '8.3.4' } });
    expect(installProblem([{ dir: studio, command: 'npm run studio:install' }])).toBeNull();
    expect(
      installProblem([
        { dir: root, command: 'npm install' },
        { dir: studio, command: 'npm run studio:install' },
      ]),
    ).toBe(
      'Notes Studio dependencies do not match the lockfiles. Run `npm install` from the repo root. ' +
        'Not as pinned: pkg-0 missing (lockfile 1.0.0), pkg-1 missing (lockfile 1.0.0), pkg-2 missing (lockfile 1.0.0), ' +
        'pkg-3 missing (lockfile 1.0.0), pkg-4 missing (lockfile 1.0.0) and 3 more.',
    );
  });
});
