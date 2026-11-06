import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKeyedLock } from '../../../server/files/store';
import { loadTree } from '../../../server/tree/build';
import { planDelete, runDelete } from '../../../server/tree/delete';

const page = (title: string, body = '') => `---\ntitle: ${title}\n---\n\n${body}\n`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

// A small notes tree: a folder `guide` with a folder page, two pages and a
// sub-folder, a page `solo` next to it, and a page the root lists as `!hidden`.
const FILES: Record<string, string | Buffer> = {
  'content/docs/index.mdx': page('Home'),
  'content/docs/meta.yaml': 'title: Notes\npages:\n  - guide\n  - solo\n  - "!hidden"\n',
  'content/docs/solo.mdx': page('Solo', '[setup](/docs/guide/setup) and [deep](./guide/deep/a.mdx) and [elsewhere](https://example.com)\n\n![shared](/docs/guide/setup/shared.png)'),
  'content/docs/hidden.mdx': page('Hidden'),
  'content/docs/guide/meta.yaml': 'title: Guide\npages:\n  # the start\n  - index\n  - intro\n  - setup # how to begin\n  - deep\n',
  'content/docs/guide/index.mdx': page('Guide', '![logo](/docs/guide/logo.png)'),
  'content/docs/guide/intro.mdx': page('Intro', 'See [setup](./setup.mdx), then [the deep end](/docs/guide/deep/a).'),
  'content/docs/guide/setup.mdx': page('Setup', '![shot](/docs/guide/setup/shot.png)\n\n![shared](/docs/guide/setup/shared.png)'),
  'content/docs/guide/deep/meta.yaml': 'title: Deep\npages: [a]\n',
  'content/docs/guide/deep/a.mdx': page('A', '![x](/docs/guide/deep/a/x.png)'),
  'public/docs/guide/logo.png': PNG,
  'public/docs/guide/setup/shot.png': PNG,
  'public/docs/guide/setup/shared.png': PNG,
  'public/docs/guide/deep/a/x.png': PNG,
  'package.json': '{}\n',
};

describe('deleting from the tree', () => {
  let root: string;
  const at = (path: string) => join(root, path);
  const text = (path: string) => readFile(at(path), 'utf8');
  const exists = (path: string) => stat(at(path)).then(() => true, () => false);
  const lock = createKeyedLock();
  const dryRun = (path: string) => runDelete(root, lock, { path, dryRun: true });
  const remove = async (path: string) => runDelete(root, lock, { path, base: (await dryRun(path)).base });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'notes-studio-delete-'));
    for (const [path, content] of Object.entries(FILES)) {
      await mkdir(dirname(at(path)), { recursive: true });
      await writeFile(at(path), content);
    }
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('shows a page delete in a dry run and writes nothing', async () => {
    const answer = await dryRun('guide/setup.mdx');
    expect(answer.changes).toEqual([
      { type: 'delete', path: 'guide/setup.mdx' },
      { type: 'change', path: 'guide/meta.yaml', detail: 'removes "setup"' },
      { type: 'keep', path: 'public/docs/guide/setup/shared.png', detail: 'used by solo.mdx' },
      { type: 'delete', path: 'public/docs/guide/setup/shot.png' },
    ]);
    expect(answer.links).toEqual([
      { note: 'guide/intro.mdx', line: 5, href: './setup.mdx' },
      { note: 'solo.mdx', line: 5, href: '/docs/guide/setup' },
    ]);
    expect(answer.deleted).toEqual(['guide/setup.mdx']);
    expect(answer.base).toMatch(/^[0-9a-f]{24}$/);
    expect(await exists('content/docs/guide/setup.mdx')).toBe(true);
    expect(await exists('public/docs/guide/setup/shot.png')).toBe(true);
  });

  it('deletes a page, its entry and the images only it used, keeping the rest of meta.yaml as it was', async () => {
    await remove('guide/setup.mdx');
    expect(await exists('content/docs/guide/setup.mdx')).toBe(false);
    expect(await text('content/docs/guide/meta.yaml')).toBe('title: Guide\npages:\n  # the start\n  - index\n  - intro\n  - deep\n');
    expect(await exists('public/docs/guide/setup/shot.png')).toBe(false);
    expect(await exists('public/docs/guide/setup/shared.png')).toBe(true);
    const tree = await loadTree(root);
    const guide = tree.children.find((child) => child.kind === 'folder' && child.path === 'guide');
    expect(guide?.kind === 'folder' && guide.children.map((child) => child.kind === 'page' || child.kind === 'folder' ? child.path : child.kind)).toEqual(['guide/index.mdx', 'guide/intro.mdx', 'guide/deep']);
  });

  it('takes out an entry the folder lists as !name', async () => {
    const answer = await remove('hidden.mdx');
    expect(answer.changes).toContainEqual({ type: 'change', path: 'meta.yaml', detail: 'removes "!hidden"' });
    expect(await text('content/docs/meta.yaml')).toBe('title: Notes\npages:\n  - guide\n  - solo\n');
  });

  it("deletes a folder page and its own images; the folder and its children's images stay", async () => {
    const answer = await remove('guide/index.mdx');
    expect(answer.changes).toEqual([
      { type: 'delete', path: 'guide/index.mdx' },
      { type: 'change', path: 'guide/meta.yaml', detail: 'removes "index"' },
      { type: 'delete', path: 'public/docs/guide/logo.png' },
    ]);
    expect(await exists('content/docs/guide/intro.mdx')).toBe(true);
    expect(await exists('public/docs/guide/setup/shot.png')).toBe(true);
    expect(await text('content/docs/meta.yaml')).toBe(FILES['content/docs/meta.yaml']);
  });

  it('deletes a folder with every page, meta.yaml and image in it, and its entry above', async () => {
    const answer = await dryRun('guide');
    expect(answer.deleted).toEqual(['guide/deep/a.mdx', 'guide/index.mdx', 'guide/intro.mdx', 'guide/setup.mdx']);
    expect(answer.links).toEqual([
      { note: 'solo.mdx', line: 5, href: '/docs/guide/setup' },
      { note: 'solo.mdx', line: 5, href: './guide/deep/a.mdx' },
    ]);
    await runDelete(root, lock, { path: 'guide', base: answer.base });
    expect(await exists('content/docs/guide')).toBe(false);
    expect(await text('content/docs/meta.yaml')).toBe('title: Notes\npages:\n  - solo\n  - "!hidden"\n');
    expect(await exists('public/docs/guide/deep')).toBe(false);
    expect(await exists('public/docs/guide/logo.png')).toBe(false);
    // solo.mdx still shows it.
    expect(await exists('public/docs/guide/setup/shared.png')).toBe(true);
    expect(await exists('public/docs/guide/setup/shot.png')).toBe(false);
  });

  it('takes out the entry of a folder the delete leaves empty, with the folder', async () => {
    await mkdir(at('content/docs/lone'), { recursive: true });
    await writeFile(at('content/docs/lone/only.mdx'), page('Only'));
    await writeFile(at('content/docs/meta.yaml'), 'title: Notes\npages:\n  - guide\n  - lone\n  - solo\n  - "!hidden"\n');
    const answer = await remove('lone/only.mdx');
    expect(answer.changes).toContainEqual({ type: 'change', path: 'meta.yaml', detail: 'removes "lone"' });
    expect(await text('content/docs/meta.yaml')).toBe(FILES['content/docs/meta.yaml']);
    expect(await exists('content/docs/lone')).toBe(false);
  });

  it("leaves the images of a folder's pages when a page of the same name goes", async () => {
    await mkdir(at('content/docs/guide/setup'), { recursive: true });
    await writeFile(at('content/docs/guide/setup/more.mdx'), page('More'));
    await mkdir(at('public/docs/guide/setup/more'), { recursive: true });
    await writeFile(at('public/docs/guide/setup/more/unused.png'), PNG);
    const answer = await remove('guide/setup.mdx');
    expect(answer.changes.map((change) => change.path)).not.toContain('public/docs/guide/setup/more/unused.png');
    expect(await exists('public/docs/guide/setup/more/unused.png')).toBe(true);
    expect(await exists('public/docs/guide/setup/shot.png')).toBe(false);
  });

  it('answers the delete when what follows it fails', async () => {
    const { base } = await dryRun('hidden.mdx');
    const answer = await runDelete(root, lock, { path: 'hidden.mdx', base }, () => { throw new Error('proposals are broken'); });
    expect(answer.deleted).toEqual(['hidden.mdx']);
    expect(await exists('content/docs/hidden.mdx')).toBe(false);
  });

  it('keeps the entry of a page next to a folder of the same name: it still reaches the other one', async () => {
    await writeFile(at('content/docs/meta.yaml'), 'pages:\n  - x\n  - solo\n');
    await writeFile(at('content/docs/x.mdx'), page('X page'));
    await mkdir(at('content/docs/x'), { recursive: true });
    await writeFile(at('content/docs/x/meta.yaml'), 'title: X\npages: [a]\n');
    await writeFile(at('content/docs/x/a.mdx'), page('A'));
    // The page goes: `x` reaches the folder still.
    expect((await dryRun('x.mdx')).changes).toEqual([{ type: 'delete', path: 'x.mdx' }]);
    // The folder goes: `x` then reaches the page.
    expect((await dryRun('x')).changes).toEqual([{ type: 'delete', path: 'x/a.mdx' }, { type: 'delete', path: 'x/meta.yaml' }]);
    await remove('x');
    expect(await text('content/docs/meta.yaml')).toBe('pages:\n  - x\n  - solo\n');
    // Both gone: the entry reaches nothing and goes too.
    await remove('x.mdx');
    expect(await text('content/docs/meta.yaml')).toBe('pages:\n  - solo\n');
  });

  it('tells onDeleted what went', async () => {
    const told: unknown[] = [];
    await runDelete(root, lock, { path: 'guide/deep', base: (await dryRun('guide/deep')).base }, (target, notes) => { told.push(target, notes); });
    expect(told).toEqual(['guide/deep', ['guide/deep/a.mdx']]);
  });

  it('refuses a delete whose files changed since the dry run', async () => {
    const { base } = await dryRun('guide/setup.mdx');
    const later = new Date(Date.now() + 5000);
    await utimes(at('content/docs/guide/meta.yaml'), later, later);
    await expect(runDelete(root, lock, { path: 'guide/setup.mdx', base })).rejects.toMatchObject({ status: 409 });
    expect(await exists('content/docs/guide/setup.mdx')).toBe(true);
  });

  it('refuses a folder delete when a page was added to it since the dry run', async () => {
    const { base } = await dryRun('guide/deep');
    await writeFile(at('content/docs/guide/deep/b.mdx'), page('B'));
    await expect(runDelete(root, lock, { path: 'guide/deep', base })).rejects.toMatchObject({ status: 409 });
    expect(await exists('content/docs/guide/deep/a.mdx')).toBe(true);
  });

  it('refuses a delete without a base, the root, a path outside the notes and one that is not there', async () => {
    await expect(runDelete(root, lock, { path: 'solo.mdx' })).rejects.toMatchObject({ status: 400 });
    await expect(dryRun('index.mdx')).rejects.toMatchObject({ status: 400 });
    await expect(dryRun('')).rejects.toMatchObject({ status: 400 });
    await expect(dryRun('../package.json.mdx')).rejects.toMatchObject({ status: 403 });
    await expect(dryRun('../../etc')).rejects.toMatchObject({ status: 403 });
    await expect(dryRun('nope.mdx')).rejects.toMatchObject({ status: 404 });
    await expect(dryRun('guide/nope')).rejects.toMatchObject({ status: 404 });
  });

  it('plans from the tree it is given', async () => {
    const tree = await loadTree(root);
    await rm(at('content/docs/solo.mdx'));
    await expect(planDelete(root, tree, { path: 'solo.mdx' })).rejects.toMatchObject({ status: 404 });
  });
});
