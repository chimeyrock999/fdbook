import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { notesMetaSchema } from '@fdbook/mdx/notes-schema.ts';
import { git } from '@fdbook/testing/git.ts';
import { startTestStudio, type TestStudio } from '@fdbook/testing/studio.ts';
import { json, rawRequest } from '#tests/support/http.ts';
import { newMetaNameOf } from '@fdbook/shared/asset-types.ts';
import type { TreeFolder, TreeNode } from '@fdbook/shared/tree.ts';
import { loadTree } from '#services/tree/build.ts';
import { planDelete } from '#services/tree/delete.ts';
import { insertEntry, keepEntries, metaTemplate, moveEntry, readPages, removeKey, replaceEntry, setFlag } from '#services/tree/meta-json.ts';
import { MetaEditError } from '#services/tree/meta-edit.ts';
import { newMetaName } from '#services/tree/meta-file.ts';
import { applyPlan, planCreate, planMove, planRename, planSetOpen, planVisibility } from '#services/tree/ops.ts';
import { writeMetaVisible } from '#services/tree/visible-edit.ts';

describe('meta.json edits', () => {
  const inline = '{ "title": "My Docs", "pages": ["test", "index", "getting-started"] }';
  const block = '{\n  "title": "Guide",\n  "pages": [\n    "a",\n    "b"\n  ]\n}\n';
  const tabs = '{\n\t"title": "Guide",\n\t"pages": [\n\t\t"a",\n\t\t"b"\n\t]\n}\n';

  it('reads the pages list, or null without one', () => {
    expect(readPages(inline)).toEqual(['test', 'index', 'getting-started']);
    expect(readPages('{"title": "X"}')).toBeNull();
    expect(() => readPages('{"pages": [')).toThrow(MetaEditError);
    expect(() => readPages('["a"]')).toThrow('meta.json is not an object');
  });

  it('moves an entry, keeping a list on one line and the missing final newline', () => {
    expect(moveEntry(inline, 2, 0)).toBe('{ "title": "My Docs", "pages": ["getting-started", "test", "index"] }');
    expect(moveEntry(block, 0, 1)).toBe('{\n  "title": "Guide",\n  "pages": [\n    "b",\n    "a"\n  ]\n}\n');
    expect(() => moveEntry('{"title": "X"}', 0, 1)).toThrow('meta.json has no pages list');
  });

  it('inserts an entry set apart like the others: spaces, tabs or one line', () => {
    expect(insertEntry(inline, 'new', 1)).toBe('{ "title": "My Docs", "pages": ["test", "new", "index", "getting-started"] }');
    expect(insertEntry(inline, 'new', 3)).toBe('{ "title": "My Docs", "pages": ["test", "index", "getting-started", "new"] }');
    expect(insertEntry(block, 'c', 2)).toBe('{\n  "title": "Guide",\n  "pages": [\n    "a",\n    "b",\n    "c"\n  ]\n}\n');
    expect(insertEntry(tabs, 'c', 0)).toBe('{\n\t"title": "Guide",\n\t"pages": [\n\t\t"c",\n\t\t"a",\n\t\t"b"\n\t]\n}\n');
    const four = '{\n    "pages": [\n        "only"\n    ]\n}';
    expect(insertEntry(four, 'next', 1)).toBe('{\n    "pages": [\n        "only",\n        "next"\n    ]\n}');
    // An empty list opens on its own lines when the keys sit on theirs.
    expect(insertEntry('{\n    "title": "X",\n    "pages": []\n}\n', 'a', 0)).toBe('{\n    "title": "X",\n    "pages": [\n        "a"\n    ]\n}\n');
    expect(insertEntry('{ "pages": [] }', 'a', 0)).toBe('{ "pages": ["a"] }');
    expect(insertEntry('{"title": "X"}', 'a', 0)).toBeNull();
  });

  it('replaces an entry and keeps only the entries asked for', () => {
    expect(replaceEntry(inline, 0, 'trial')).toBe('{ "title": "My Docs", "pages": ["trial", "index", "getting-started"] }');
    expect(keepEntries(block, (value) => value !== 'a')).toBe('{\n  "title": "Guide",\n  "pages": [\n    "b"\n  ]\n}\n');
    expect(keepEntries(inline, (value) => value !== 'index')).toBe('{ "title": "My Docs", "pages": ["test", "getting-started"] }');
    expect(keepEntries(inline, () => false)).toBe('{ "title": "My Docs", "pages": [] }');
    expect(keepEntries(inline, () => true)).toBe(inline);
  });

  it('sets a flag after the title, and removes it again byte for byte', () => {
    const set = setFlag(block, 'defaultOpen', true);
    expect(set).toBe('{\n  "title": "Guide",\n  "defaultOpen": true,\n  "pages": [\n    "a",\n    "b"\n  ]\n}\n');
    expect(setFlag(set, 'defaultOpen', false)).toBe(set.replace('true', 'false'));
    expect(removeKey(set, 'defaultOpen')).toBe(block);
    expect(removeKey(setFlag(inline, 'visible', false), 'visible')).toBe(inline);
    expect(setFlag('{"pages": ["a"]}', 'visible', false)).toBe('{"visible": false, "pages": ["a"]}');
    expect(setFlag('{}', 'visible', false)).toBe('{ "visible": false }');
    expect(removeKey('{ "visible": false }', 'visible')).toBe('{}');
    // The last key takes the separator before it.
    expect(removeKey('{\n\t"pages": [],\n\t"visible": false\n}', 'visible')).toBe('{\n\t"pages": []\n}');
  });

  it('writes new files as fumadocs does, which its meta schema takes', () => {
    const template = metaTemplate('Raft', [], true);
    expect(template).toBe('{\n  "title": "Raft",\n  "defaultOpen": true,\n  "pages": []\n}\n');
    expect(notesMetaSchema.safeParse(JSON.parse(template)).success).toBe(true);
    expect(notesMetaSchema.safeParse(JSON.parse(writeMetaVisible('{ "visible": false }', true, 'meta.json'))).success).toBe(true);
  });
});

describe('the format of a new meta file', () => {
  it('is meta.yaml only when the notes have some and no meta.json', () => {
    expect(newMetaNameOf([])).toBe('meta.json');
    expect(newMetaNameOf(['content/docs/meta.yaml', 'content/docs/a/meta.yaml'])).toBe('meta.yaml');
    expect(newMetaNameOf(['content/docs/meta.yaml', 'content/docs/a/meta.json'])).toBe('meta.json');
    expect(newMetaNameOf(['meta.json'])).toBe('meta.json');
  });
});

// A site as create-fumadocs-app starts it: meta.json files, no meta.yaml.
// Each test gets its own copy.
describe('a notes folder with meta.json', () => {
  let root: string;
  const at = (path: string) => join(root, 'content/docs', path);
  const read = (path: string) => readFile(at(path), 'utf8');
  const write = async (path: string, text: string) => {
    await mkdir(dirname(at(path)), { recursive: true });
    await writeFile(at(path), text);
  };
  const page = (title: string) => `---\ntitle: ${title}\n---\n\n${title}.\n`;
  const ROOT = '{ "title": "My Docs", "pages": ["test", "index", "getting-started", "guide", "secret"] }';
  const GUIDE = '{\n    "title": "Guide",\n    "pages": [\n        "b",\n        "a"\n    ]\n}\n';
  const SECRET = '{\n\t"title": "Secret",\n\t"visible": false\n}';

  const find = (folder: TreeFolder, path: string): TreeNode | undefined => {
    for (const child of folder.children) {
      if ((child.kind === 'page' || child.kind === 'folder') && child.path === path) return child;
      if (child.kind === 'folder') {
        const found = find(child, path);
        if (found) return found;
      }
    }
    return undefined;
  };
  const folderAt = async (path: string) => find(await loadTree(root), path) as TreeFolder;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'notes-meta-json-'));
    await write('meta.json', ROOT);
    for (const [path, title] of [['index.mdx', 'Hello World'], ['test.mdx', 'Test'], ['getting-started.mdx', 'Getting Started'], ['guide/a.mdx', 'A'], ['guide/b.mdx', 'B'], ['secret/x.mdx', 'X']]) await write(path, page(title));
    await write('guide/meta.json', GUIDE);
    await write('secret/meta.json', SECRET);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('builds the tree from it: title, order, nested pages and visible: false', async () => {
    const tree = await loadTree(root);
    expect([tree.title, tree.meta]).toEqual(['My Docs', 'meta.json']);
    expect(tree.children.map((child) => (child.kind === 'missing' ? child.value : child.title))).toEqual(['Test', 'Hello World', 'Getting Started', 'Guide', 'Secret']);
    const guide = find(tree, 'guide') as TreeFolder;
    expect([guide.meta, guide.ignoredMeta]).toEqual(['guide/meta.json', undefined]);
    expect(guide.children.map((child) => [child.kind === 'page' ? child.path : '', child.entry])).toEqual([['guide/b.mdx', 0], ['guide/a.mdx', 1]]);
    expect((find(tree, 'secret') as TreeFolder).hidden).toBe('visible-false');
  });

  it('reads the meta.json of a folder that has a meta.yaml too, and marks it', async () => {
    await write('guide/meta.yaml', 'title: Other\npages:\n  - a\n  - b\n');
    const guide = await folderAt('guide');
    expect([guide.title, guide.meta, guide.ignoredMeta]).toEqual(['Guide', 'guide/meta.json', 'guide/meta.yaml']);
    expect(guide.children.map((child) => child.kind === 'page' && child.path)).toEqual(['guide/b.mdx', 'guide/a.mdx']);
  });

  it('creates a page and a folder in it, the folder with a meta.json', async () => {
    expect(await newMetaName(root)).toBe('meta.json');
    await applyPlan(root, await planCreate(root, await loadTree(root), { parent: '', slug: 'new-page', title: 'New page', kind: 'page', defaultOpen: false, after: 0 }));
    expect(await read('meta.json')).toBe('{ "title": "My Docs", "pages": ["test", "new-page", "index", "getting-started", "guide", "secret"] }');
    const plan = await planCreate(root, await loadTree(root), { parent: 'guide', slug: 'raft', title: 'Raft', kind: 'plain-folder', defaultOpen: true, after: null });
    expect(plan.changes).toEqual([{ type: 'add', path: 'guide/raft/meta.json' }, { type: 'change', path: 'guide/meta.json', detail: 'adds "raft"' }]);
    await applyPlan(root, plan);
    expect(await read('guide/raft/meta.json')).toBe(metaTemplate('Raft', [], true));
    expect(await read('guide/meta.json')).toBe('{\n    "title": "Guide",\n    "pages": [\n        "b",\n        "a",\n        "raft"\n    ]\n}\n');
  });

  it('creates a meta.yaml for a new folder in notes that use meta.yaml', async () => {
    for (const path of ['meta.json', 'guide/meta.json', 'secret/meta.json']) await rm(at(path));
    await write('meta.yaml', 'title: My Docs\n');
    const plan = await planCreate(root, await loadTree(root), { parent: 'guide', slug: 'raft', title: 'Raft', kind: 'plain-folder', defaultOpen: false, after: null });
    expect(plan.changes).toEqual([{ type: 'add', path: 'guide/raft/meta.yaml' }]);
  });

  it('renames a page in its meta.json', async () => {
    await applyPlan(root, await planRename(root, await loadTree(root), { path: 'guide/a.mdx', slug: 'alpha' }));
    expect(await read('guide/meta.json')).toBe(GUIDE.replace('"a"', '"alpha"'));
    await applyPlan(root, await planRename(root, await loadTree(root), { path: 'guide', slug: 'manual' }));
    expect(await read('meta.json')).toBe(ROOT.replace('"guide"', '"manual"'));
  });

  it('moves an entry, and writes a meta.json for a folder without a meta file', async () => {
    const guide = await folderAt('guide');
    await applyPlan(root, await planMove(root, await loadTree(root), { folder: 'guide', from: 1, to: 0, baseMtime: guide.metaMtime }));
    expect(await read('guide/meta.json')).toBe('{\n    "title": "Guide",\n    "pages": [\n        "a",\n        "b"\n    ]\n}\n');
    for (const name of ['one', 'two']) await write(`plain/${name}.mdx`, page(name));
    await applyPlan(root, await planMove(root, await loadTree(root), { folder: 'plain', from: 1, to: 0, baseMtime: null }));
    expect(await read('plain/meta.json')).toBe('{\n  "pages": [\n    "two",\n    "one"\n  ]\n}\n');
  });

  it('sets defaultOpen in a meta.json', async () => {
    const guide = await folderAt('guide');
    await applyPlan(root, await planSetOpen(root, await loadTree(root), { folder: 'guide', defaultOpen: true, baseMtime: guide.metaMtime }));
    expect(await read('guide/meta.json')).toBe('{\n    "title": "Guide",\n    "defaultOpen": true,\n    "pages": [\n        "b",\n        "a"\n    ]\n}\n');
  });

  it('hides and shows a folder by its meta.json, byte for byte', async () => {
    await applyPlan(root, await planVisibility(root, await loadTree(root), { path: 'guide', visible: false }));
    expect(await read('guide/meta.json')).toBe('{\n    "title": "Guide",\n    "visible": false,\n    "pages": [\n        "b",\n        "a"\n    ]\n}\n');
    await applyPlan(root, await planVisibility(root, await loadTree(root), { path: 'guide', visible: true }));
    expect(await read('guide/meta.json')).toBe(GUIDE);
    await applyPlan(root, await planVisibility(root, await loadTree(root), { path: 'secret', visible: true }));
    expect(await read('secret/meta.json')).toBe('{\n\t"title": "Secret"\n}');
  });

  it('hides a folder without a meta file by a new meta.json, and drops it when shown', async () => {
    await write('loose/one.mdx', page('One'));
    await applyPlan(root, await planVisibility(root, await loadTree(root), { path: 'loose', visible: false }));
    expect(await read('loose/meta.json')).toBe('{\n  "visible": false,\n  "pages": [\n    "one"\n  ]\n}\n');
    await applyPlan(root, await planVisibility(root, await loadTree(root), { path: 'loose', visible: true }));
    await expect(stat(at('loose/meta.json'))).rejects.toThrow();
  });

  it('takes a deleted page out of its meta.json', async () => {
    const plan = await planDelete(root, await loadTree(root), { path: 'guide/b.mdx' });
    expect(plan.changes).toContainEqual({ type: 'change', path: 'guide/meta.json', detail: 'removes "b"' });
    await applyPlan(root, plan);
    expect(await read('guide/meta.json')).toBe('{\n    "title": "Guide",\n    "pages": [\n        "a"\n    ]\n}\n');
    await applyPlan(root, await planDelete(root, await loadTree(root), { path: 'guide' }));
    expect(await read('meta.json')).toBe('{ "title": "My Docs", "pages": ["test", "index", "getting-started", "secret"] }');
  });
});

// Restoring deleted pages (#114) into folders ordered by meta.json, through
// the real server on a git worktree copy of the docs.
describe('restoring a deleted page into a meta.json', () => {
  let studio: TestStudio;
  let first: string;
  const LAB = 'content/docs/json-lab';
  const SHELF = 'content/docs/json-shelf';
  const at = (path: string) => join(studio.root, path);
  const read = (path: string) => readFile(at(path), 'utf8');
  const page = (title: string) => `---\ntitle: ${title}\n---\n\n${title}.\n`;
  const commit = (message: string) => {
    git(studio.root, 'add', '-A');
    git(studio.root, 'commit', '--quiet', '-m', message);
    return git(studio.root, 'rev-parse', 'HEAD').trim();
  };
  const restore = (body: unknown) =>
    rawRequest(`${studio.url}api/history/restore-deleted`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: studio.origin },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    studio = await startTestStudio({ git: true });
    await mkdir(at(LAB), { recursive: true });
    await mkdir(at(SHELF), { recursive: true });
    await writeFile(at(`${LAB}/meta.json`), '{\n  "title": "Json lab",\n  "pages": ["a", "b", "c"]\n}\n');
    for (const name of ['a', 'b', 'c']) await writeFile(at(`${LAB}/${name}.mdx`), page(name));
    await writeFile(at(`${SHELF}/meta.json`), '{\n\t"title": "Json shelf",\n\t"pages": [\n\t\t"one",\n\t\t"two"\n\t]\n}\n');
    for (const name of ['one', 'two']) await writeFile(at(`${SHELF}/${name}.mdx`), page(name));
    first = commit('docs: add the json lab and shelf');
    await rm(at(`${LAB}/b.mdx`));
    await writeFile(at(`${LAB}/meta.json`), '{\n  "title": "Json lab",\n  "pages": ["a", "c"]\n}\n');
    await rm(at(SHELF), { recursive: true });
    commit('docs: drop b and the shelf');
  });
  afterAll(async () => {
    await studio.close();
  });

  it('lists the page again where it was', async () => {
    const response = await restore({ path: `${LAB}/b.mdx`, sha: first });
    expect(json(response)).toMatchObject({ changes: [{ type: 'add', path: `${LAB}/b.mdx` }, { type: 'change', path: `${LAB}/meta.json`, detail: 'adds "b"' }] });
    expect(await read(`${LAB}/meta.json`)).toBe('{\n  "title": "Json lab",\n  "pages": ["a", "b", "c"]\n}\n');
  });

  it('brings back the meta.json of a folder that went, listing only what comes back', async () => {
    const response = await restore({ path: `${SHELF}/two.mdx`, sha: first });
    expect(response.status).toBe(200);
    expect(await read(`${SHELF}/meta.json`)).toBe('{\n\t"title": "Json shelf",\n\t"pages": [\n\t\t"two"\n\t]\n}\n');
  });
});
