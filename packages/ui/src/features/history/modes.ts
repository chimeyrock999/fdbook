import type { Comparison } from '#api/history.ts';

export type Mode = 'rendered' | 'source';

// Whether a history is an asset's (a file under public/notes), not a note's.
export const isAsset = (path: string) => !path.endsWith('.mdx');

// The views a history has: a note renders and has its source; an asset
// previews (an image as it looks, any other file as its size), and one sent
// as text (an SVG) has its source too.
export function modesOf(path: string, comparison: Comparison | null): Mode[] {
  if (!isAsset(path)) return ['rendered', 'source'];
  const text = comparison !== null && [comparison.before, comparison.after].every((side) => side === null || side.kind === 'text');
  return text ? ['rendered', 'source'] : ['rendered'];
}
