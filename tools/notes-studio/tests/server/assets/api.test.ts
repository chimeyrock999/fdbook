import { chmod, cp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSyncClient, SYNC_ENDPOINT, wsTransport, type DocumentEditor } from '@fumadocs-editor/core/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAssetPlan, planAssetRename } from '../../../server/assets/ops';
import { repoRoot } from '../../../server/config';
import { lintWorktree } from '../../../server/lint/context';
import { json, rawRequest } from '../../support/http';
import { generatedAsset, plantGeneratedAsset } from '../../support/generated-asset';
import { startTestStudio, type TestStudio } from '../../support/studio';
import { CORPUS_TIMEOUT_MS } from '../../support/timeouts';

type Usage = { note: string; line: number; column: number; text: string; unsure: boolean };
type Asset = { path: string; mtimeMs: number; usages: Usage[]; sources: { path: string; line: number; text: string }[] };
type Answer = { changes: { type: string; path: string; to?: string; detail?: string }[]; usages: Usage[] };

class TextEditor implements DocumentEditor {
  text = '';
  external: string[] = [];
  getMarkdown() {
    return this.text;
  }
  applyExternalMarkdown(text: string) {
    this.external.push(text);
    this.text = text;
    return Promise.resolve([]);
  }
  setMarkdown(text: string) {
    this.text = text;
    return Promise.resolve();
  }
  markSaved() {
    // keeps no base
  }
}

const SUPERSET = 'public/notes/data-platform/stacks-integration/superset-trino-impersonate.jpg';
const WAREHOUSE = 'public/notes/data-modeling/data_warehouse_architecture.webp';
// Generated assets the tests plant (support/generated-asset.ts): one to
// list and rename, one to refuse a delete of.
const MADE = generatedAsset('made');
const KEPT = generatedAsset('kept');

// The assets API on a copy of the real content/notes and public/notes. The
// tests run in order and build on each other's changes.
describe('assets API', () => {
  let studio: TestStudio;

  const file = (path: string) => join(studio.root, path);
  const text = (path: string) => readFile(file(path), 'utf8');
  const exists = (path: string) => stat(file(path)).then(() => true, () => false);
  const mtime = async (path: string) => (await stat(file(path))).mtimeMs;
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    rawRequest(`${studio.url}api/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: studio.origin, ...headers },
      body: JSON.stringify(body),
    });
  const list = async () => (json(await rawRequest(`${studio.url}api/assets`)) as { assets: Asset[] }).assets;
  const find = async (path: string) => (await list()).find((asset) => asset.path === path);
  const missingAssets = async () =>
    (await lintWorktree(studio.root)).flatMap(({ path, issues }) => issues.filter((issue) => issue.rule === 'asset-missing').map((issue) => `${path} ${issue.message}`));

  beforeAll(async () => {
    studio = await startTestStudio();
    await cp(join(repoRoot, 'public/notes'), file('public/notes'), { recursive: true });
    await cp(join(repoRoot, 'diagrams'), file('diagrams'), { recursive: true });
    await plantGeneratedAsset(studio.root, 'made');
    await plantGeneratedAsset(studio.root, 'kept', { embed: false });
  });

  afterAll(async () => {
    await studio.close();
  });

  it('lists every asset with the notes and lines that use it', async () => {
    const assets = await list();
    const byPath = (path: string) => assets.find((asset) => asset.path === path);
    expect(assets.every((asset) => asset.path.startsWith('public/notes/') || asset.path.startsWith('diagrams/'))).toBe(true);
    expect(byPath(SUPERSET)).toMatchObject({
      mtimeMs: await mtime(SUPERSET),
      usages: [{ note: 'content/notes/data-platform/stacks-integration/index.mdx', line: 157, unsure: false }],
    });
    expect(byPath(SUPERSET)?.usages[0].text).toMatch(/^!\[Superset .*superset-trino-impersonate\.jpg\)$/);
    expect(byPath('public/notes/demo/pixel.png')?.usages).toEqual([]);
    expect(assets.flatMap((asset) => asset.usages).length).toBeGreaterThanOrEqual(9);
    expect(await missingAssets()).toEqual([]);
  }, 20_000);

  it('lists the diagrams with the notes whose <Diagram> draws them', async () => {
    const assets = await list();
    const diagrams = assets.filter((asset) => asset.path.startsWith('diagrams/'));
    expect(diagrams.length).toBeGreaterThanOrEqual(8);
    expect(diagrams.every((asset) => asset.path.endsWith('.diagram.json'))).toBe(true);
    const vantage = diagrams.find((asset) => asset.path.endsWith('/driver-container-vantage-point.diagram.json'));
    expect(vantage?.usages).toMatchObject([{ note: 'content/notes/data-platform/stacks-integration/databricks/databricks-interactive-runtime/driver-container-first-look.mdx', line: 39, unsure: false }]);
    expect(vantage?.usages[0].text).toMatch(/^<Diagram src="/);
  });

  it('names the diagram sources that generate an asset', async () => {
    const generated = await find(MADE.asset);
    expect(generated?.usages.map((usage) => usage.note)).toEqual([MADE.note]);
    expect(generated?.sources).toEqual([
      { path: MADE.spec, line: 3, text: MADE.specLine },
      { path: MADE.script, line: 2, text: MADE.scriptLine },
    ]);
    expect((await find(SUPERSET))?.sources).toEqual([]);
  });

  describe('rename', () => {
    it('shows a dry run and writes nothing', async () => {
      const response = await post({ op: 'rename', dryRun: true, path: WAREHOUSE, name: 'data-warehouse-architecture', baseMtime: await mtime(WAREHOUSE) });
      expect(response.status).toBe(200);
      expect((json(response) as Answer).changes).toEqual([
        { type: 'move', path: WAREHOUSE, to: 'public/notes/data-modeling/data-warehouse-architecture.webp' },
        { type: 'change', path: 'content/notes/data-modeling/index.mdx', detail: '1 reference' },
      ]);
      expect(await exists(WAREHOUSE)).toBe(true);
    });

    it('renames the file and every reference to it; the lint stays clean', async () => {
      const note = 'content/notes/data-modeling/index.mdx';
      const before = await text(note);
      const response = await post({ op: 'rename', path: WAREHOUSE, name: 'data-warehouse-architecture', baseMtime: await mtime(WAREHOUSE) });
      expect(response.status).toBe(200);
      expect(await exists(WAREHOUSE)).toBe(false);
      expect(await exists('public/notes/data-modeling/data-warehouse-architecture.webp')).toBe(true);
      expect(await text(note)).toBe(before.replace('data_warehouse_architecture.webp', 'data-warehouse-architecture.webp'));
      expect(await missingAssets()).toEqual([]);
    }, 20_000);

    it('keeps the query of an embed, and says which diagram sources still name the old path', async () => {
      const before = await text(MADE.note);
      const response = await post({ op: 'rename', path: MADE.asset, name: 'made-layers', baseMtime: await mtime(MADE.asset) });
      expect(response.status).toBe(200);
      expect((json(response) as Answer).changes.filter((change) => change.type === 'keep').map((change) => change.path)).toEqual([MADE.spec, MADE.script]);
      expect(await text(MADE.note)).toBe(before.replace('/made.html?embed=1', '/made-layers.html?embed=1'));
      expect(await missingAssets()).toEqual([]);
    }, 20_000);

    it('refuses bad names, taken names, stale files and paths outside public/notes', async () => {
      const baseMtime = await mtime(SUPERSET);
      expect((await post({ op: 'rename', path: SUPERSET, name: 'Superset Trino', baseMtime })).status).toBe(400);
      expect((await post({ op: 'rename', path: SUPERSET, name: 'superset-trino-impersonate', baseMtime })).status).toBe(400);
      await writeFile(file('public/notes/data-platform/stacks-integration/taken.jpg'), 'x');
      expect((await post({ op: 'rename', path: SUPERSET, name: 'taken', baseMtime })).status).toBe(409);
      expect((await post({ op: 'rename', path: SUPERSET, name: 'fresh', baseMtime: baseMtime - 1000 })).status).toBe(409);
      expect((await post({ op: 'rename', path: 'content/notes/index.mdx', name: 'x', baseMtime })).status).toBe(403);
      expect((await post({ op: 'rename', path: 'public/notes/../notes/demo/pixel.png', name: 'x', baseMtime })).status).toBe(403);
      expect((await post({ op: 'rename', path: 'public/notes/nothing.png', name: 'x', baseMtime })).status).toBe(404);
      expect((await post({ op: 'shred', path: SUPERSET })).status).toBe(400);
      expect(await exists(SUPERSET)).toBe(true);
    });

    it('refuses a symlinked asset', async () => {
      await symlink(file(SUPERSET), file('public/notes/demo/linked.jpg'));
      const response = await post({ op: 'rename', path: 'public/notes/demo/linked.jpg', name: 'x', baseMtime: 0 });
      expect(response.status).toBe(403);
    });

    it('refuses when a note changed after the plan, before moving anything', async () => {
      const note = 'content/notes/data-platform/stacks-integration/index.mdx';
      const plan = await planAssetRename(studio.root, { path: SUPERSET, name: 'superset-impersonation', baseMtime: await mtime(SUPERSET) });
      await writeFile(file(note), `${await text(note)}\nedited elsewhere\n`);
      await expect(applyAssetPlan(studio.root, plan)).rejects.toMatchObject({ status: 409 });
      expect(await exists(SUPERSET)).toBe(true);
    }, CORPUS_TIMEOUT_MS);

    it('rewrites a reference written with a Markdown escape', async () => {
      await mkdir(file('public/notes/zz-escaped'), { recursive: true });
      await writeFile(file('public/notes/zz-escaped/foo_bar.png'), 'x');
      await writeFile(file('content/notes/zz-escaped.mdx'), 'See [the picture](/notes/zz-escaped/foo\\_bar.png).\n');
      expect((await find('public/notes/zz-escaped/foo_bar.png'))?.usages).toHaveLength(1);
      const response = await post({ op: 'rename', path: 'public/notes/zz-escaped/foo_bar.png', name: 'foo-bar', baseMtime: await mtime('public/notes/zz-escaped/foo_bar.png') });
      expect((json(response) as Answer).changes).toContainEqual({ type: 'change', path: 'content/notes/zz-escaped.mdx', detail: '1 reference' });
      expect(await text('content/notes/zz-escaped.mdx')).toBe('See [the picture](/notes/zz-escaped/foo-bar.png).\n');
    });

    it('moves the asset back when the first note cannot be written', async () => {
      // Its own asset, used by one note in a folder that cannot be written.
      const asset = 'public/notes/zz-escaped/locked-asset.png';
      await writeFile(file(asset), 'x');
      await mkdir(file('content/notes/zz-a-locked'));
      await writeFile(file('content/notes/zz-a-locked/a.mdx'), '![a](/notes/zz-escaped/locked-asset.png)\n');
      const plan = await planAssetRename(studio.root, { path: asset, name: 'locked', baseMtime: await mtime(asset) });
      await chmod(file('content/notes/zz-a-locked'), 0o555);
      try {
        const failure: unknown = await applyAssetPlan(studio.root, plan).then(() => null, (error: unknown) => error);
        expect(failure).toMatchObject({ status: 500 });
        expect((failure as Error).message).toContain('nothing was changed');
      } finally {
        await chmod(file('content/notes/zz-a-locked'), 0o755);
      }
      expect(await exists(asset)).toBe(true);
      expect(await exists('public/notes/zz-escaped/locked.png')).toBe(false);
      await rm(file('content/notes/zz-a-locked'), { recursive: true });
    }, CORPUS_TIMEOUT_MS);

    it('lists usages in note and line order', async () => {
      const usages = (await find('public/notes/zz-escaped/foo-bar.png'))?.usages ?? [];
      expect(usages.map((usage) => usage.note)).toEqual([...usages.map((usage) => usage.note)].sort());
    });

    it('counts a broken note only for a name it holds whole', async () => {
      await writeFile(file('public/notes/zz-escaped/ta.png'), 'x');
      await writeFile(file('content/notes/zz-broken-name.mdx'), '<HtmlEmbed src="/notes/elsewhere/data.png"\n');
      expect((await find('public/notes/zz-escaped/ta.png'))?.usages).toEqual([]);
      await rm(file('content/notes/zz-broken-name.mdx'));
    });

    it('counts a reference it cannot place as unsure, which blocks delete', async () => {
      const asset = 'public/notes/zz-escaped/ta.png';
      await writeFile(file('content/notes/zz-unplaced.mdx'), '![a](/notes/zz-escaped/ta&period;png)\n');
      expect((await find(asset))?.usages).toMatchObject([{ note: 'content/notes/zz-unplaced.mdx', line: 1, unsure: true }]);
      expect((await post({ op: 'delete', path: asset, baseMtime: await mtime(asset) })).status).toBe(409);
      expect((await post({ op: 'rename', path: asset, name: 'tb', baseMtime: await mtime(asset) })).status).toBe(409);
      await rm(file('content/notes/zz-unplaced.mdx'));
    });

    it('refuses while a note that does not parse may use it', async () => {
      const broken = 'content/notes/zz-broken.mdx';
      await writeFile(file(broken), '<HtmlEmbed src="/notes/data-platform/stacks-integration/superset-trino-impersonate.jpg"\n');
      expect((await find(SUPERSET))?.usages.at(-1)).toMatchObject({ note: broken, line: 1, unsure: true });
      const response = await post({ op: 'rename', path: SUPERSET, name: 'superset', baseMtime: await mtime(SUPERSET) });
      expect(response.status).toBe(409);
      expect((json(response) as { error: string }).error).toContain(broken);
    });

    it('updates a note open in the editor through its sync', async () => {
      const note = 'content/notes/data-platform/processing/apache-spark/spark-programming-model.mdx';
      const svg = 'public/notes/data-platform/processing/apache-spark/narrow-vs-wide-transformations.svg';
      const client = createSyncClient({ transport: wsTransport(`ws://127.0.0.1:${studio.port}${SYNC_ENDPOINT}`) });
      try {
        const editor = new TextEditor();
        const doc = client.open(note.slice('content/notes/'.length), { editor });
        editor.text = (await doc.opened).text;
        const response = await post({ op: 'rename', path: svg, name: 'narrow-vs-wide', baseMtime: await mtime(svg) });
        expect(response.status).toBe(200);
        await expect.poll(() => editor.external.at(-1) ?? '', { timeout: 5000 }).toContain('src="/notes/data-platform/processing/apache-spark/narrow-vs-wide.svg"');
        expect(doc.status()).toBe('synced');
      } finally {
        client.close();
      }
    });
  });

  describe('delete', () => {
    it('refuses while a note uses the asset, and lists where', async () => {
      const used = 'public/notes/data-modeling/data-warehouse-architecture.webp';
      const dry = await post({ op: 'delete', dryRun: true, path: used, baseMtime: await mtime(used) });
      expect(dry.status).toBe(409);
      expect((json(dry) as { error: string }).error).toMatch(/content\/notes\/data-modeling\/index\.mdx/);
      expect((await post({ op: 'delete', path: used, baseMtime: await mtime(used) })).status).toBe(409);
      expect(await exists(used)).toBe(true);
    });

    it('deletes an unused asset and the folders it leaves empty', async () => {
      await writeFile(file('public/notes/demo/other.png'), 'x');
      const first = await post({ op: 'delete', path: 'public/notes/demo/pixel.png', baseMtime: await mtime('public/notes/demo/pixel.png') });
      expect(first.status).toBe(200);
      expect((json(first) as Answer).changes).toEqual([{ type: 'delete', path: 'public/notes/demo/pixel.png' }]);
      expect(await exists('public/notes/demo')).toBe(true);
      await rm(file('public/notes/demo/linked.jpg'));
      const rest = await post({ op: 'delete', path: 'public/notes/demo/other.png', baseMtime: await mtime('public/notes/demo/other.png') });
      expect(rest.status).toBe(200);
      expect(await exists('public/notes/demo')).toBe(false);
      expect(await exists('public/notes')).toBe(true);
    });

    it('refuses to delete an asset a diagram source generates', async () => {
      const response = await post({ op: 'delete', path: KEPT.asset, baseMtime: await mtime(KEPT.asset) });
      expect(response.status).toBe(409);
      expect((json(response) as { error: string }).error).toMatch(/kept\.architecture\.json, .*kept\.regen\.sh generates kept\.html/);
      expect(await exists(KEPT.asset)).toBe(true);
    });

    it('refuses a stale delete', async () => {
      const unused = 'public/notes/data-platform/stacks-integration/taken.jpg';
      expect((await post({ op: 'delete', path: unused, baseMtime: (await mtime(unused)) - 1 })).status).toBe(409);
      expect(await exists(unused)).toBe(true);
    });
  });

  it('takes JSON only', async () => {
    const response = await rawRequest(`${studio.url}api/assets`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: studio.origin }, body: '{}' });
    expect(response.status).toBe(415);
  });
});
