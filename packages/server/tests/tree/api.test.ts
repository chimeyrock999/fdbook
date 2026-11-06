import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lintWorktree } from '#lint/context.ts';
import type { TreeFolder, TreeNode } from '@fdbook/shared/tree.ts';
import { json, rawRequest } from '#tests/support/http.ts';
import { startTestStudio, type TestStudio } from '@fdbook/testing/studio.ts';
import { CORPUS_TIMEOUT_MS } from '#tests/support/timeouts.ts';
import { writeTreeCases } from '#tests/support/tree-cases.ts';

type Answer = { changes: { type: string; path: string; to?: string; detail?: string }[]; open: string | null };

// The tree API on a copy of the real content/docs, plus the cases it does
// not have (support/tree-cases.ts). The tests run in order and build on each
// other's changes.
describe('tree API', () => {
  let studio: TestStudio;
  let lintBefore: string[];

  const notes = (path: string) => join(studio.root, 'content/docs', path);
  const text = (path: string) => readFile(notes(path), 'utf8');
  const mtime = async (path: string) => (await stat(notes(path))).mtimeMs;
  const exists = (path: string) => stat(notes(path)).then(() => true, () => false);
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    rawRequest(`${studio.url}api/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: studio.origin, ...headers },
      body: JSON.stringify(body),
    });
  const tree = async () => (json(await rawRequest(`${studio.url}api/tree`)) as { tree: TreeFolder }).tree;
  const lintIssues = async () =>
    (await lintWorktree(studio.root)).flatMap(({ path, issues }) => issues.map((issue) => `${path} ${issue.rule} ${issue.message}`));

  beforeAll(async () => {
    studio = await startTestStudio();
    await writeTreeCases(studio.root);
    // The copy lacks most of public/ and diagrams/, so asset issues are expected: compare with these.
    lintBefore = await lintIssues();
  });

  afterAll(async () => {
    await studio.close();
  });

  it('serves the tree', async () => {
    const root = await tree();
    expect(root.title).toBe('FdBook');
    expect(root.children.map((child) => (child.kind === 'folder' || child.kind === 'page') && child.path).slice(0, 5)).toEqual([
      'index.mdx',
      'guide',
      'reference',
      'diagrams',
      'patterns',
    ]);
  });

  describe('create', () => {
    it('shows a dry run and writes nothing', async () => {
      const response = await post({ op: 'create', dryRun: true, parent: 'reference', slug: 'glossary', title: 'Glossary', after: 0 });
      expect(response.status).toBe(200);
      expect((json(response) as Answer).changes).toEqual([
        { type: 'add', path: 'reference/glossary.mdx' },
        { type: 'change', path: 'reference/meta.yaml', detail: 'adds "glossary"' },
      ]);
      expect(await exists('reference/glossary.mdx')).toBe(false);
    });

    it('creates a page after the given entry, from the template', async () => {
      const meta = await text('reference/meta.yaml');
      const response = await post({ op: 'create', parent: 'reference', slug: 'glossary', title: 'Glossary "Terms"', after: 0 });
      expect(response.status).toBe(200);
      expect((json(response) as Answer).open).toBe('reference/glossary.mdx');
      expect(await text('reference/glossary.mdx')).toBe(
        '---\ntitle: "Glossary \\"Terms\\""\ndescription: ""\ngraph:\n  id: "glossary"\n  displayName: "Glossary \\"Terms\\""\n  keywords: []\n  sections: []\n---\n\n',
      );
      expect(await text('reference/meta.yaml')).toBe(
        meta.replace('  - "architecture"\n', '  - "architecture"\n  - "glossary"\n'),
      );
    });

    it('creates a folder page; a parent without meta.yaml lists it by itself', async () => {
      const response = await post({ op: 'create', parent: 'patterns', slug: 'retries', title: 'Retries', kind: 'folder-page', defaultOpen: true });
      expect(response.status).toBe(200);
      expect((json(response) as Answer).changes.map((change) => change.path)).toEqual(['patterns/retries/index.mdx', 'patterns/retries/meta.yaml']);
      expect(await text('patterns/retries/meta.yaml')).toBe('title: "Retries"\ndefaultOpen: true\npages: []\n');
      expect(await exists('patterns/meta.yaml')).toBe(false);
    });

    it('shows a dry run of a plain folder: its meta.yaml and the parent entry', async () => {
      const response = await post({ op: 'create', dryRun: true, parent: 'guide', slug: 'foo', title: 'Foo', kind: 'plain-folder', after: 0 });
      expect(response.status).toBe(200);
      expect(json(response)).toEqual({
        changes: [
          { type: 'add', path: 'guide/foo/meta.yaml' },
          { type: 'change', path: 'guide/meta.yaml', detail: 'adds "foo"' },
        ],
        open: null,
        created: 'guide/foo',
      });
      expect(await exists('guide/foo')).toBe(false);
    });

    it('creates a plain folder with only a meta.yaml, closed by default', async () => {
      const meta = await text('guide/meta.yaml');
      const response = await post({ op: 'create', parent: 'guide', slug: 'foo', title: 'Foo', kind: 'plain-folder', after: 0 });
      expect(response.status).toBe(200);
      expect((json(response) as Answer).open).toBeNull();
      expect(await text('guide/foo/meta.yaml')).toBe('title: "Foo"\ndefaultOpen: false\npages: []\n');
      expect(await exists('guide/foo/index.mdx')).toBe(false);
      expect(await text('guide/meta.yaml')).toBe(meta.replace('  - "setup"\n', '  - "setup"\n  - "foo"\n'));
      const guide = (await tree()).children.find((child) => child.kind === 'folder' && child.path === 'guide') as TreeFolder;
      const foo = guide.children.find((child) => child.kind === 'folder' && child.path === 'guide/foo');
      expect(foo).toMatchObject({ id: 'folder:guide/foo', entry: 1, title: 'Foo', index: null, hidden: null, defaultOpen: false, children: [] });
    });

    it('creates a page in the new folder and lists it there', async () => {
      const response = await post({ op: 'create', parent: 'guide/foo', slug: 'bar', title: 'Bar' });
      expect(response.status).toBe(200);
      expect(await text('guide/foo/meta.yaml')).toBe('title: "Foo"\ndefaultOpen: false\npages:\n  - "bar"\n');
      expect(await exists('guide/foo/bar.mdx')).toBe(true);
    });

    it('refuses a taken name, a bad slug, `index` and an unknown folder', async () => {
      expect((await post({ op: 'create', parent: 'patterns', slug: 'caching', title: 'x' })).status).toBe(409);
      const old = await post({ op: 'create', parent: 'reference', slug: 'x', title: 'x', kind: 'folder' });
      expect([old.status, (json(old) as { error: string }).error]).toEqual([400, 'kind `folder` is now `folder-page`: reload the Studio']);
      expect((await post({ op: 'create', parent: 'reference', slug: 'glossary', title: 'x', kind: 'folder-page' })).status).toBe(409);
      expect((await post({ op: 'create', parent: 'guide', slug: 'foo', title: 'x', kind: 'page' })).status).toBe(409);
      expect((await post({ op: 'create', parent: 'reference', slug: 'glossary', title: 'x', kind: 'plain-folder' })).status).toBe(409);
      expect((await post({ op: 'create', parent: 'reference', slug: 'Not A Slug', title: 'x', kind: 'plain-folder' })).status).toBe(400);
      expect((await post({ op: 'create', parent: 'reference', slug: 'x', title: 'x', kind: 'group' })).status).toBe(400);
      expect((await post({ op: 'create', parent: 'reference', slug: 'Not A Slug', title: 'x' })).status).toBe(400);
      expect((await post({ op: 'create', parent: 'reference', slug: 'index', title: 'x' })).status).toBe(400);
      expect((await post({ op: 'create', parent: 'nowhere', slug: 'x', title: 'x' })).status).toBe(404);
    });
  });

  describe('set-open', () => {
    it('sets defaultOpen in place, from the mtime it was read at', async () => {
      const path = 'guide/meta.yaml';
      const before = await text(path);
      expect((await post({ op: 'set-open', folder: 'guide', defaultOpen: false, baseMtime: (await mtime(path)) - 1 })).status).toBe(409);
      const response = await post({ op: 'set-open', folder: 'guide', defaultOpen: false, baseMtime: await mtime(path) });
      expect(response.status).toBe(200);
      expect(json(response)).toEqual({ changes: [{ type: 'change', path, detail: 'defaultOpen: false' }], open: null });
      expect(await text(path)).toBe(before.replace('defaultOpen: true', 'defaultOpen: false'));
      const guide = (await tree()).children.find((child) => child.kind === 'folder' && child.path === 'guide') as TreeFolder;
      expect(guide.defaultOpen).toBe(false);
    });

    it('refuses a folder without meta.yaml, the root and an unknown folder', async () => {
      expect((await post({ op: 'set-open', folder: 'patterns', defaultOpen: true, baseMtime: null })).status).toBe(409);
      expect(await exists('patterns/meta.yaml')).toBe(false);
      expect((await post({ op: 'set-open', folder: '', defaultOpen: true, baseMtime: await mtime('meta.yaml') })).status).toBe(400);
      expect((await post({ op: 'set-open', folder: 'nowhere', defaultOpen: true, baseMtime: null })).status).toBe(404);
      const missing = await post({ op: 'set-open', defaultOpen: true, baseMtime: null });
      expect([missing.status, (json(missing) as { error: string }).error]).toEqual([400, 'folder must be a folder path']);
      expect((await post({ op: 'set-open', folder: 'guide', defaultOpen: 'yes', baseMtime: await mtime('guide/meta.yaml') })).status).toBe(400);
    });
  });

  describe('move', () => {
    it('reorders meta.yaml and keeps the rest of the file as it was', async () => {
      const path = 'guide/meta.yaml';
      const before = await text(path);
      expect((await post({ op: 'move', folder: 'guide', from: 1, to: 0, baseMtime: (await mtime(path)) - 1 })).status).toBe(409);
      const response = await post({ op: 'move', folder: 'guide', from: 1, to: 0, baseMtime: await mtime(path) });
      expect(response.status).toBe(200);
      expect(await text(path)).toBe(before.replace('  - "setup"\n  - "foo"', '  - "foo"\n  - "setup"'));
    });

    it('writes a meta.yaml for a folder that has none', async () => {
      const patterns = (await tree()).children.find((child) => child.kind === 'folder' && child.path === 'patterns') as TreeFolder;
      expect(patterns.children.map((child) => [child.entry, child.kind === 'folder' && child.path])).toEqual([
        [0, 'patterns/caching'],
        [1, 'patterns/retries'],
      ]);
      const response = await post({ op: 'move', folder: 'patterns', from: 0, to: 1, baseMtime: null });
      expect(response.status).toBe(200);
      // Only the order: the title still comes from the index page, and the site keeps the folder closed by default.
      expect(await text('patterns/meta.yaml')).toBe('pages:\n  - "retries"\n  - "caching"\n');
      const patternsAfter = (await tree()).children.find((child) => child.kind === 'folder' && child.path === 'patterns') as TreeFolder;
      expect(patternsAfter.title).toBe(patterns.title);
      expect((await post({ op: 'move', folder: 'patterns', from: 0, to: 1, baseMtime: null })).status).toBe(409);
    });
  });

  describe('rename', () => {
    it('renames a page listed by a nested entry and fixes the links to it', async () => {
      const index = await text('archive/index.mdx');
      const meta = await text('archive/meta.yaml');
      const response = await post({ op: 'rename', path: 'archive/old/setup-v1.mdx', slug: 'first-setup' });
      expect(response.status).toBe(200);
      expect((json(response) as Answer).changes).toEqual([
        { type: 'move', path: 'archive/old/setup-v1.mdx', to: 'archive/old/first-setup.mdx' },
        { type: 'change', path: 'archive/index.mdx', detail: '1 link' },
        { type: 'change', path: 'archive/meta.yaml', detail: '1 entry' },
      ]);
      expect(await exists('archive/old/setup-v1.mdx')).toBe(false);
      expect(await exists('archive/old/first-setup.mdx')).toBe(true);
      expect(await text('archive/meta.yaml')).toBe(meta.replace('"old/setup-v1"', '"old/first-setup"'));
      expect(await text('archive/index.mdx')).toBe(index.replace('](./old/setup-v1.mdx)', '](./old/first-setup.mdx)'));
    });

    it('renames a folder and fixes /docs links, anchors included', async () => {
      const response = await post({ op: 'rename', path: 'diagrams', slug: 'drawings' });
      expect(response.status).toBe(200);
      const changed = (json(response) as Answer).changes.map((change) => `${change.type} ${change.path} ${change.detail ?? change.to ?? ''}`);
      expect(changed).toEqual([
        'move diagrams drawings',
        'change index.mdx 1 link',
        'change meta.yaml 1 entry',
        'change patterns/index.mdx 1 link',
      ]);
      expect(await text('meta.yaml')).toContain('  - "drawings"\n');
      expect(await text('patterns/index.mdx')).toContain('](/docs/drawings/examples#architecture)');
      expect(await exists('drawings/examples.mdx')).toBe(true);
    });

    it('leaves the notes with no new lint issue', async () => {
      // A note's path leads the issue; its message may name diagrams/ files, which keep their place.
      const renamed = (issue: string) => issue.replace(/^content\/docs\/diagrams\//, 'content/docs/drawings/').replace('setup-v1', 'first-setup');
      expect((await lintIssues()).map(renamed).sort()).toEqual(lintBefore.map(renamed).sort());
    }, CORPUS_TIMEOUT_MS);

    it('refuses the root page, an index page and a taken name', async () => {
      expect((await post({ op: 'rename', path: 'index.mdx', slug: 'home' })).status).toBe(400);
      expect((await post({ op: 'rename', path: 'drawings/index.mdx', slug: 'x' })).status).toBe(400);
      expect((await post({ op: 'rename', path: 'reference/glossary.mdx', slug: 'lint' })).status).toBe(409);
      expect((await post({ op: 'rename', path: 'reference/nothing.mdx', slug: 'x' })).status).toBe(404);
    });
  });

  describe('visibility', () => {
    it('shows a dry run, then hides the page', async () => {
      const path = 'reference/lint.mdx';
      const before = await text(path);
      const dry = await post({ op: 'visibility', dryRun: true, path, visible: false });
      expect(dry.status).toBe(200);
      expect((json(dry) as Answer).changes).toEqual([{ type: 'change', path, detail: 'visible: false' }]);
      expect(await text(path)).toBe(before);
      expect((await post({ op: 'visibility', path, visible: false })).status).toBe(200);
      expect(await text(path)).toContain('\nvisible: false\n');
      expect((await post({ op: 'visibility', path, visible: true })).status).toBe(200);
      expect(await text(path)).toBe(before);
    });

    it('refuses the root page and a request without visible', async () => {
      expect((await post({ op: 'visibility', path: 'index.mdx', visible: false })).status).toBe(400);
      expect((await post({ op: 'visibility', path: 'reference' })).status).toBe(400);
      expect((await post({ op: 'visibility', path: 'nothing.mdx', visible: false })).status).toBe(404);
    });
  });

  it('takes only JSON from this origin', async () => {
    expect((await post({ op: 'move' }, { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await post({ op: 'move' }, { Origin: 'http://evil.example' })).status).toBe(403);
    expect((await post({ op: 'delete' })).status).toBe(400);
    expect((await rawRequest(`${studio.url}api/tree`, { method: 'DELETE', headers: { Origin: studio.origin } })).status).toBe(405);
  });

  it('shows the new tree', async () => {
    const all: string[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.kind === 'page' || node.kind === 'folder') all.push(node.path);
        if (node.kind === 'folder') walk(node.children);
      }
    };
    walk((await tree()).children);
    expect(all).toContain('reference/glossary.mdx');
    expect(all).toContain('drawings');
    expect(all).not.toContain('diagrams');
  });
});
