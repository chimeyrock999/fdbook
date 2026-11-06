import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installRoot } from './config.ts';

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

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// The direct dependencies of the package at `dir` that are missing or
// installed at another version than its package-lock.json pins, as
// `name installed (lockfile version)`. Empty when `dir` has no lockfile.
// A package put in place with `npm link` is skipped: the link is deliberate
// (e.g. a local clone to try an upstream fix) and the lockfile never records it.
export function driftedPackages(dir: string): string[] {
  const manifest = read(join(dir, 'package.json')) as Manifest | null;
  const lockfile = read(join(dir, 'package-lock.json')) as Lockfile | null;
  if (!manifest || !lockfile?.packages) return [];
  const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  return names.flatMap((name) => {
    const locked = lockfile.packages?.[`node_modules/${name}`]?.version;
    if (locked === undefined) return [];
    const path = join(dir, 'node_modules', name);
    if (isLink(path)) return [];
    const installed = (read(join(path, 'package.json')) as Manifest | null)?.version;
    if (installed === locked) return [];
    return [`${name} ${installed ?? 'missing'} (lockfile ${locked})`];
  });
}

// How many drifted packages the message names; a checkout with nothing
// installed misses about 90.
const SHOWN = 5;

// Every package installs from the one lockfile at the repo root. The message
// for a checkout that does not match it, the command first, or null when it
// does. The server's startup and the test run's global setup both use it.
export function installProblem(
  checks = [
    { dir: installRoot, command: 'npm install' },
  ],
): string | null {
  const problems = checks.flatMap(({ dir, command }) => {
    const drifted = driftedPackages(dir);
    return drifted.length > 0 ? [{ drifted, command }] : [];
  });
  if (problems.length === 0) return null;
  const commands = problems.map(({ command }) => `\`${command}\``).join(' and ');
  const drifted = problems.flatMap(({ drifted }) => drifted);
  const rest = drifted.length - SHOWN;
  const listed = drifted.slice(0, SHOWN).join(', ') + (rest > 0 ? ` and ${String(rest)} more` : '');
  return `Notes Studio dependencies do not match the lockfiles. Run ${commands} from the repo root. Not as pinned: ${listed}.`;
}
