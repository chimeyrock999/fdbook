import { describe, expect, it, vi } from 'vitest';
import { buildTree } from '../../../server/tree/build';

// fumadocs-core 16.8.11 gives a folder without meta.yaml no $ref at all: the
// page tree the old loader returns for content/notes/deep/a.mdx.
vi.mock('fumadocs-core/source', () => ({
  loader: () => ({
    getPageTree: () => ({ name: '', children: [{ type: 'folder', name: 'Deep', children: [] }] }),
  }),
}));

describe('a page tree folder without $ref', () => {
  it('names the old fumadocs-core install as a cause, not only the loader', () => {
    const content = { pages: new Map([['deep/a.mdx', { title: 'A' }]]), metas: new Map() };
    expect(() => buildTree(content)).toThrow(
      'a page tree folder (Deep) has no $ref.folder: either fumadocs-core is older than the site requires (run `npm install` from the repo root), or the loader drops refs.',
    );
  });
});
