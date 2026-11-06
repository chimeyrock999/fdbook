// Change request slugs. No Node imports: the UI reads the same rules to show
// the branch a name will get and to read `?cr=` from the URL.
import { slugify } from './slug.ts';

// `cr-` plus the slug stays within the 28 characters Cloudflare Pages keeps
// of a branch name in its preview alias, so the preview URL can be read off
// the branch.
export const CR_SLUG_MAX = 24;
export const CR_BRANCH_PREFIX = 'cr/';

export const isCrSlug = (value: string) => value.length <= CR_SLUG_MAX && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

const cut = (slug: string, max: number) => slug.slice(0, max).replace(/-+$/, '');

// The slug for a change request named `name`: kebab-case ASCII, at most
// CR_SLUG_MAX characters, and `-2`, `-3`, … when `taken` has it already.
// Null when the name has no letter or digit.
export function crSlug(name: string, taken: ReadonlySet<string> = new Set()): string | null {
  const base = cut(slugify(name), CR_SLUG_MAX);
  if (base === '') return null;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${String(n)}`;
    const slug = `${cut(base, CR_SLUG_MAX - suffix.length)}${suffix}`;
    if (!taken.has(slug)) return slug;
  }
}
