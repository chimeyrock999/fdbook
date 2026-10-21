import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A pull that changed package-lock.json without a reinstall leaves
// node_modules on the old versions, and the Studio then runs against
// packages whose shape it does not expect: with fumadocs-core 16.8.11 every
// page tree folder got the same id, so opening one opened all. The check is
// the one `npm install` would act on: each direct dependency installed at
// the version package-lock.json pins.

type Manifest = { version?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
type Lockfile = { packages?: Record<string, { version?: string } | undefined> };

function read(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// The direct dependencies of the package at `dir` that are missing or
// installed at another version than its package-lock.json pins, as
// `name installed (lockfile version)`. Empty when `dir` has no lockfile.
export function driftedPackages(dir: string): string[] {
  const manifest = read(join(dir, 'package.json')) as Manifest | null;
  const lockfile = read(join(dir, 'package-lock.json')) as Lockfile | null;
  if (!manifest || !lockfile?.packages) return [];
  const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  return names.flatMap((name) => {
    const locked = lockfile.packages?.[`node_modules/${name}`]?.version;
    if (locked === undefined) return [];
    const installed = (read(join(dir, 'node_modules', name, 'package.json')) as Manifest | null)?.version;
    if (installed === locked) return [];
    return [`${name} ${installed ?? 'missing'} (lockfile ${locked})`];
  });
}
