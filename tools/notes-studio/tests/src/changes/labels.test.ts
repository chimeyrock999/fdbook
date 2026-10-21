import { describe, expect, it } from 'vitest';
import type { TreeFolder } from '../../../src/api/tree';
import { labelOf, shortPath, timeAgo, titlesOf } from '../../../src/changes/labels';

const root: TreeFolder = {
  kind: 'folder', id: 'folder:', path: '', title: 'Notes', meta: 'meta.yaml', metaMtime: null, index: 'index.mdx', defaultOpen: true, icon: null, hidden: null, entry: null,
  children: [
    {
      kind: 'folder', id: 'folder:streaming', path: 'streaming', title: 'Streaming', meta: 'streaming/meta.yaml', metaMtime: null, index: 'streaming/index.mdx',
      defaultOpen: true, icon: null, hidden: null, entry: 0,
      children: [{ kind: 'page', id: 'page:streaming/w.mdx', path: 'streaming/w.mdx', title: 'Watermarks', icon: null, entry: 0, hidden: null }],
    },
  ],
};

describe('labels', () => {
  const titles = titlesOf(root);

  it('names notes by title, meta.yaml as the page order, the rest by file name', () => {
    expect(labelOf({ path: 'content/notes/streaming/w.mdx', status: 'M' }, titles)).toBe('Watermarks');
    expect(labelOf({ path: 'content/notes/streaming/index.mdx', status: 'M' }, titles)).toBe('Streaming');
    expect(labelOf({ path: 'content/notes/streaming/meta.yaml', status: 'M' }, titles)).toBe('Page order of Streaming');
    expect(labelOf({ path: 'content/notes/meta.yaml', status: 'M' }, titles)).toBe('Page order of Notes');
    expect(labelOf({ path: 'content/notes/new/meta.yaml', status: 'A' }, titles)).toBe('Page order of new');
    expect(labelOf({ path: 'content/notes/streaming/gone.mdx', status: 'D' }, titles)).toBe('gone');
    expect(labelOf({ path: 'public/notes/streaming/a.png', status: 'A' }, titles)).toBe('a.png');
    expect(shortPath('public/notes/streaming/a.png')).toBe('streaming/a.png');
  });

  it('says how long ago a commit was', () => {
    const now = Date.parse('2026-10-22T10:00:00Z');
    expect(timeAgo('2026-10-22T09:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-10-22T09:15:00Z', now)).toBe('45 min ago');
    expect(timeAgo('2026-10-22T09:00:00Z', now)).toBe('1 hour ago');
    expect(timeAgo('2026-10-22T05:00:00+02:00', now)).toBe('7 hours ago');
    expect(timeAgo('2026-10-01T09:00:00Z', now)).toMatch(/2026/);
  });
});
