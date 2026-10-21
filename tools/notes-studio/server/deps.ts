import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Root packages the Studio server reads at runtime and whose shape it relies
// on: the page tree reads fumadocs-core's page tree nodes ($ref.folder only
// exists from 16.17). A checkout that pulled a bump but did not reinstall
// would otherwise run with the old package and build a broken tree.
const ROOT_PACKAGES = ['fumadocs-core'];

const parse = (version: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(version)?.slice(1).map(Number) ?? null;

// Whether `version` meets `range`, for the ranges the root package.json uses:
// `^x.y.z` (same major, at least x.y.z) or an exact `x.y.z`. Anything else
// is taken as met.
export function meets(range: string, version: string): boolean {
  const caret = range.startsWith('^');
  const wanted = parse(caret ? range.slice(1) : range);
  const have = parse(version);
  if (!wanted || !have) return true;
  const [major, minor, patch] = have as [number, number, number];
  const [wantMajor, wantMinor, wantPatch] = wanted as [number, number, number];
  if (!caret) return major === wantMajor && minor === wantMinor && patch === wantPatch;
  if (major !== wantMajor) return false;
  return minor > wantMinor || (minor === wantMinor && patch >= wantPatch);
}

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as { version?: string; dependencies?: Record<string, string> };

// The root packages whose installed version is older than the root
// package.json asks for, as `name installed (wants range)`.
export function staleRootPackages(root: string): string[] {
  const wanted = readJson(join(root, 'package.json')).dependencies ?? {};
  return ROOT_PACKAGES.flatMap((name) => {
    const range = wanted[name];
    if (!range) return [];
    let installed: string | undefined;
    try {
      installed = readJson(join(root, 'node_modules', name, 'package.json')).version;
    } catch {
      return [`${name} missing (wants ${range})`];
    }
    return installed === undefined || meets(range, installed) ? [] : [`${name} ${installed} (wants ${range})`];
  });
}
