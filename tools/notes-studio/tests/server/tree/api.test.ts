import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lintWorktree } from '../../../server/lint/context';
import type { TreeFolder, TreeNode } from '../../../server/tree/types';
import { json, rawRequest } from '../../support/http';
import { startTestStudio, type TestStudio } from '../../support/studio';

type Answer = { changes: { type: string; path: string; to?: string; detail?: string }[]; open: string | null };

// The tree API on a copy of the real content/notes. The tests run in order
// and build on each other's changes.
describe('tree API', () => {
  let studio: TestStudio;
  let lintBefore: string[];

  const notes = (path: string) => join(studio.root, 'content/notes', path);
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
    // The copy lacks most of public/, so asset issues are expected: compare with these.
    lintBefore = await lintIssues();
  });

  afterAll(async () => {
    await studio.close();
  });

  it('serves the tree', async () => {
    const root = await tree();
    expect(root.title).toBe('Notes');
    expect(root.children.map((child) => child.kind === 'folder' && child.path).slice(0, 4)).toEqual([
      'data-platform',
      'data-modeling',
      'distributed-systems',
      'personal-reflections',
    ]);
  });

  describe('create', () => {
    it('shows a dry run and writes nothing', async () => {
      const response = await post({ op: 'create', dryRun: true, parent: 'distributed-systems', slug: 'raft', title: 'Raft', after: 0 });
      expect(response.status).toBe(200);
      expect((json(response) as Answer).changes).toEqual([
        { type: 'add', path: 'distributed-systems/raft.mdx' },
        { type: 'change', path: 'distributed-systems/meta.yaml', detail: 'adds "raft"' },
      ]);
      expect(await exists('distributed-systems/raft.mdx')).toBe(false);
    });

    it('creates a page after the given entry, from the template', async () => {
      const meta = await text('distributed-systems/meta.yaml');
      const response = await post({ op: 'create', parent: 'distributed-systems', slug: 'raft', title: 'Raft "Consensus"', after: 0 });
      expect(response.status).toBe(200);
      expect((json(response) as Answer).open).toBe('distributed-systems/raft.mdx');
      expect(await text('distributed-systems/raft.mdx')).toBe(
        '---\ntitle: "Raft \\"Consensus\\""\ndescription: ""\ngraph:\n  id: "raft"\n  displayName: "Raft \\"Consensus\\""\n  keywords: []\n  sections: []\n---\n\n',
      );
      expect(await text('distributed-systems/meta.yaml')).toBe(
        meta.replace('  - "foundations-of-distributed-systems"\n', '  - "foundations-of-distributed-systems"\n  - "raft"\n'),
      );
    });

    it('creates a folder page; a parent without meta.yaml lists it by itself', async () => {
      const response = await post({ op: 'create', parent: 'data-modeling', slug: 'data-vault', title: 'Data Vault', kind: 'folder' });
      expect(response.status).toBe(200);
      expect((json(response) as Answer).changes.map((change) => change.path)).toEqual(['data-modeling/data-vault/index.mdx', 'data-modeling/data-vault/meta.yaml']);
      expect(await text('data-modeling/data-vault/meta.yaml')).toBe('title: "Data Vault"\ndefaultOpen: true\npages: []\n');
      expect(await exists('data-modeling/meta.yaml')).toBe(false);
    });

    it('refuses a taken name, a bad slug, `index` and an unknown folder', async () => {
      expect((await post({ op: 'create', parent: 'distributed-systems', slug: 'mapreduce', title: 'x' })).status).toBe(409);
      expect((await post({ op: 'create', parent: 'distributed-systems', slug: 'raft', title: 'x', kind: 'folder' })).status).toBe(409);
      expect((await post({ op: 'create', parent: 'distributed-systems', slug: 'Not A Slug', title: 'x' })).status).toBe(400);
      expect((await post({ op: 'create', parent: 'distributed-systems', slug: 'index', title: 'x' })).status).toBe(400);
      expect((await post({ op: 'create', parent: 'nowhere', slug: 'x', title: 'x' })).status).toBe(404);
    });
  });

  describe('move', () => {
    it('reorders meta.yaml and keeps the rest of the file as it was', async () => {
      const path = 'data-platform/meta.yaml';
      const before = await text(path);
      expect((await post({ op: 'move', folder: 'data-platform', from: 1, to: 0, baseMtime: (await mtime(path)) - 1 })).status).toBe(409);
      const response = await post({ op: 'move', folder: 'data-platform', from: 1, to: 0, baseMtime: await mtime(path) });
      expect(response.status).toBe(200);
      expect(await text(path)).toBe(before.replace('  - "stacks-integration"\n  - "data-quality"', '  - "data-quality"\n  - "stacks-integration"'));
    });

    it('writes a meta.yaml for a folder that has none', async () => {
      const modeling = (await tree()).children.find((child) => child.kind === 'folder' && child.path === 'data-modeling') as TreeFolder;
      expect(modeling.children.map((child) => [child.entry, child.kind === 'folder' && child.path])).toEqual([
        [0, 'data-modeling/data-vault'],
        [1, 'data-modeling/dimensional-modeling'],
      ]);
      const response = await post({ op: 'move', folder: 'data-modeling', from: 0, to: 1, baseMtime: null });
      expect(response.status).toBe(200);
      // Only the order: the title still comes from the index page and the folder stays closed by default.
      expect(await text('data-modeling/meta.yaml')).toBe('pages:\n  - "dimensional-modeling"\n  - "data-vault"\n');
      const modelingAfter = (await tree()).children.find((child) => child.kind === 'folder' && child.path === 'data-modeling') as TreeFolder;
      expect([modelingAfter.title, modelingAfter.defaultOpen]).toEqual([modeling.title, modeling.defaultOpen]);
      expect((await post({ op: 'move', folder: 'data-modeling', from: 0, to: 1, baseMtime: null })).status).toBe(409);
    });
  });

  describe('rename', () => {
    it('renames a page listed by a nested entry and fixes the links to it', async () => {
      const index = await text('computer-systems/index.mdx');
      const meta = await text('computer-systems/meta.yaml');
      const response = await post({ op: 'rename', path: 'computer-systems/operating-systems/page-cache.mdx', slug: 'os-page-cache' });
      expect(response.status).toBe(200);
      expect((json(response) as Answer).changes).toEqual([
        { type: 'move', path: 'computer-systems/operating-systems/page-cache.mdx', to: 'computer-systems/operating-systems/os-page-cache.mdx' },
        { type: 'change', path: 'computer-systems/index.mdx', detail: '1 link' },
        { type: 'change', path: 'computer-systems/meta.yaml', detail: '1 entry' },
      ]);
      expect(await exists('computer-systems/operating-systems/page-cache.mdx')).toBe(false);
      expect(await exists('computer-systems/operating-systems/os-page-cache.mdx')).toBe(true);
      expect(await text('computer-systems/meta.yaml')).toBe(meta.replace('"operating-systems/page-cache"', '"operating-systems/os-page-cache"'));
      expect(await text('computer-systems/index.mdx')).toBe(index.replace('](./operating-systems/page-cache.mdx)', '](./operating-systems/os-page-cache.mdx)'));
    });

    it('renames a folder and fixes /notes links, anchors included', async () => {
      const response = await post({ op: 'rename', path: 'distributed-systems/mapreduce', slug: 'map-reduce' });
      expect(response.status).toBe(200);
      const changed = (json(response) as Answer).changes.map((change) => `${change.type} ${change.path} ${change.detail ?? change.to ?? ''}`);
      expect(changed).toEqual([
        'move distributed-systems/mapreduce distributed-systems/map-reduce',
        'change data-platform/processing/apache-spark/spark-programming-model.mdx 2 links',
        'change data-platform/stacks-integration/databricks/databricks-interactive-runtime/index.mdx 1 link',
        'change distributed-systems/meta.yaml 1 entry',
      ]);
      expect(await text('distributed-systems/meta.yaml')).toContain('  - "map-reduce"\n');
      expect(await text('data-platform/stacks-integration/databricks/databricks-interactive-runtime/index.mdx')).toContain('](/notes/distributed-systems/map-reduce#yarn-components)');
      expect(await exists('distributed-systems/map-reduce/mit-65840-lab01.mdx')).toBe(true);
    });

    it('leaves the notes with no new lint issue', async () => {
      const renamed = (issue: string) => issue.replace('mapreduce', 'map-reduce').replace('page-cache', 'os-page-cache');
      expect((await lintIssues()).map(renamed).sort()).toEqual(lintBefore.map(renamed).sort());
    });

    it('refuses the root page, an index page and a taken name', async () => {
      expect((await post({ op: 'rename', path: 'index.mdx', slug: 'home' })).status).toBe(400);
      expect((await post({ op: 'rename', path: 'distributed-systems/index.mdx', slug: 'x' })).status).toBe(400);
      expect((await post({ op: 'rename', path: 'distributed-systems/raft.mdx', slug: 'rpc-and-threads' })).status).toBe(409);
      expect((await post({ op: 'rename', path: 'distributed-systems/nothing.mdx', slug: 'x' })).status).toBe(404);
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
    expect(all).toContain('distributed-systems/raft.mdx');
    expect(all).toContain('distributed-systems/map-reduce');
    expect(all).not.toContain('distributed-systems/mapreduce');
  });
});
