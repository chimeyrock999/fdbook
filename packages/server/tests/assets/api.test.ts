import { chmod, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSyncClient, SYNC_ENDPOINT, wsTransport, type DocumentEditor } from '@fumadocs-editor/core/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAssetPlan, planAssetRename } from '#assets/ops.ts';
import { lintWorktree } from '#lint/context.ts';
import { json, rawRequest } from '#tests/support/http.ts';
import { startTestStudio, type TestStudio } from '@fdbook/testing/studio.ts';
import { CORPUS_TIMEOUT_MS } from '#tests/support/timeouts.ts';
import { PANES, REQUEST_PATH, SIGN_IN, writeAssetCases } from '#tests/support/asset-cases.ts';

type Usage = { note: string; line: number; column: number; text: string; unsure: boolean };
type Asset = { path: string; mtimeMs: number; usages: Usage[] };
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

const PANES_SVG = PANES.asset;
const SIGN_IN_WEBP = SIGN_IN.asset;
// An embedded HTML asset, and an unused one, each still named by a regen
// script of the retired Archify pipeline: the Studio no longer reads those.
const MADE = { asset: 'public/docs/legacy/made.html', note: 'content/docs/legacy-made.mdx', script: 'diagrams/legacy/made.regen.sh' };
const KEPT = { asset: 'public/docs/legacy/kept.html', script: 'diagrams/legacy/kept.regen.sh' };

// The assets API on a copy of the real content/docs, public/docs and
// diagrams, with images the pages use (support/asset-cases.ts). The tests
// run in order and build on each other's changes.
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
    await writeAssetCases(studio.root);
    await mkdir(file('public/docs/legacy'), { recursive: true });
    await mkdir(file('diagrams/legacy'), { recursive: true });
    for (const { asset, script } of [MADE, KEPT]) {
      await writeFile(file(asset), '<!doctype html><html><body>legacy</body></html>\n');
      await writeFile(file(script), `#!/bin/sh\nOUT="${asset}"\n`);
    }
    await writeFile(file(MADE.note), '---\ntitle: made\n---\n\n<HtmlEmbed src="/docs/legacy/made.html?embed=1" title="made" />\n');
  });

  afterAll(async () => {
    await studio.close();
  });

  it('lists every asset with the notes and lines that use it', async () => {
    const assets = await list();
    const byPath = (path: string) => assets.find((asset) => asset.path === path);
    expect(assets.every((asset) => asset.path.startsWith('public/docs/') || asset.path.startsWith('diagrams/'))).toBe(true);
    expect(byPath(PANES_SVG)).toMatchObject({
      mtimeMs: await mtime(PANES_SVG),
      usages: [{ note: PANES.note, line: (await text(PANES.note)).split('\n').indexOf(PANES.line) + 1, unsure: false }],
    });
    expect(byPath(PANES_SVG)?.usages[0].text).toMatch(/^!\[The Studio: .*studio-panes\.svg\)$/);
    expect(byPath('public/docs/demo/pixel.png')?.usages).toEqual([]);
    // The three images and the embed written above, and the six <Diagram>s of the docs.
    expect(assets.flatMap((asset) => asset.usages).length).toBeGreaterThanOrEqual(10);
    expect(await missingAssets()).toEqual([]);
  }, 20_000);

  it('lists the diagrams with the notes whose <Diagram> draws them', async () => {
    const assets = await list();
    const diagrams = assets.filter((asset) => asset.path.startsWith('diagrams/'));
    // The docs' examples and the Studio's layout.
    expect(diagrams.length).toBeGreaterThanOrEqual(9);
    expect(diagrams.every((asset) => asset.path.endsWith('.diagram.json'))).toBe(true);
    const layout = diagrams.find((asset) => asset.path === 'diagrams/reference/studio-layout.diagram.json');
    const home = (await text('content/docs/index.mdx')).split('\n');
    expect(layout?.usages).toMatchObject([{ note: 'content/docs/index.mdx', line: home.findIndex((line) => line.startsWith('<Diagram src="reference/studio-layout"')) + 1, unsure: false }]);
    expect(layout?.usages[0].text).toMatch(/^<Diagram src="/);
  });

  it('lists an asset a leftover regen script names like any other', async () => {
    expect(await find(MADE.asset)).toEqual({ path: MADE.asset, mtimeMs: await mtime(MADE.asset), size: expect.any(Number) as number, usages: [expect.objectContaining({ note: MADE.note })] });
  });

  describe('rename', () => {
    it('shows a dry run and writes nothing', async () => {
      const response = await post({ op: 'rename', dryRun: true, path: SIGN_IN_WEBP, name: 'sign-in-flow', baseMtime: await mtime(SIGN_IN_WEBP) });
      expect(response.status).toBe(200);
      expect((json(response) as Answer).changes).toEqual([
        { type: 'move', path: SIGN_IN_WEBP, to: 'public/docs/guide/setup/sign-in-flow.webp' },
        { type: 'change', path: SIGN_IN.note, detail: '1 reference' },
      ]);
      expect(await exists(SIGN_IN_WEBP)).toBe(true);
    });

    it('renames the file and every reference to it; the lint stays clean', async () => {
      const note = SIGN_IN.note;
      const before = await text(note);
      const response = await post({ op: 'rename', path: SIGN_IN_WEBP, name: 'sign-in-flow', baseMtime: await mtime(SIGN_IN_WEBP) });
      expect(response.status).toBe(200);
      expect(await exists(SIGN_IN_WEBP)).toBe(false);
      expect(await exists('public/docs/guide/setup/sign-in-flow.webp')).toBe(true);
      expect(await text(note)).toBe(before.replace('sign_in_flow.webp', 'sign-in-flow.webp'));
      expect(await missingAssets()).toEqual([]);
    }, 20_000);

    it('keeps the query of an embed, and lists no regen script', async () => {
      const before = await text(MADE.note);
      const response = await post({ op: 'rename', path: MADE.asset, name: 'made-layers', baseMtime: await mtime(MADE.asset) });
      expect(response.status).toBe(200);
      expect((json(response) as Answer).changes.map((change) => change.type)).toEqual(['move', 'change']);
      expect(await text(MADE.note)).toBe(before.replace('/made.html?embed=1', '/made-layers.html?embed=1'));
      expect(await missingAssets()).toEqual([]);
    }, 20_000);

    it('refuses bad names, taken names, stale files and paths outside public/docs', async () => {
      const baseMtime = await mtime(PANES_SVG);
      expect((await post({ op: 'rename', path: PANES_SVG, name: 'Studio Panes', baseMtime })).status).toBe(400);
      expect((await post({ op: 'rename', path: PANES_SVG, name: 'studio-panes', baseMtime })).status).toBe(400);
      await writeFile(file('public/docs/guide/using/taken.svg'), 'x');
      expect((await post({ op: 'rename', path: PANES_SVG, name: 'taken', baseMtime })).status).toBe(409);
      expect((await post({ op: 'rename', path: PANES_SVG, name: 'fresh', baseMtime: baseMtime - 1000 })).status).toBe(409);
      expect((await post({ op: 'rename', path: 'content/docs/index.mdx', name: 'x', baseMtime })).status).toBe(403);
      expect((await post({ op: 'rename', path: 'public/docs/../notes/demo/pixel.png', name: 'x', baseMtime })).status).toBe(403);
      expect((await post({ op: 'rename', path: 'public/docs/nothing.png', name: 'x', baseMtime })).status).toBe(404);
      expect((await post({ op: 'shred', path: PANES_SVG })).status).toBe(400);
      expect(await exists(PANES_SVG)).toBe(true);
    });

    it('refuses a symlinked asset', async () => {
      await symlink(file(PANES_SVG), file('public/docs/demo/linked.jpg'));
      const response = await post({ op: 'rename', path: 'public/docs/demo/linked.jpg', name: 'x', baseMtime: 0 });
      expect(response.status).toBe(403);
    });

    it('refuses when a note changed after the plan, before moving anything', async () => {
      const note = PANES.note;
      const plan = await planAssetRename(studio.root, { path: PANES_SVG, name: 'panes', baseMtime: await mtime(PANES_SVG) });
      await writeFile(file(note), `${await text(note)}\nedited elsewhere\n`);
      await expect(applyAssetPlan(studio.root, plan)).rejects.toMatchObject({ status: 409 });
      expect(await exists(PANES_SVG)).toBe(true);
    }, CORPUS_TIMEOUT_MS);

    it('rewrites a reference written with a Markdown escape', async () => {
      await mkdir(file('public/docs/zz-escaped'), { recursive: true });
      await writeFile(file('public/docs/zz-escaped/foo_bar.png'), 'x');
      await writeFile(file('content/docs/zz-escaped.mdx'), 'See [the picture](/docs/zz-escaped/foo\\_bar.png).\n');
      expect((await find('public/docs/zz-escaped/foo_bar.png'))?.usages).toHaveLength(1);
      const response = await post({ op: 'rename', path: 'public/docs/zz-escaped/foo_bar.png', name: 'foo-bar', baseMtime: await mtime('public/docs/zz-escaped/foo_bar.png') });
      expect((json(response) as Answer).changes).toContainEqual({ type: 'change', path: 'content/docs/zz-escaped.mdx', detail: '1 reference' });
      expect(await text('content/docs/zz-escaped.mdx')).toBe('See [the picture](/docs/zz-escaped/foo-bar.png).\n');
    });

    it('moves the asset back when the first note cannot be written', async () => {
      // Its own asset, used by one note in a folder that cannot be written.
      const asset = 'public/docs/zz-escaped/locked-asset.png';
      await writeFile(file(asset), 'x');
      await mkdir(file('content/docs/zz-a-locked'));
      await writeFile(file('content/docs/zz-a-locked/a.mdx'), '![a](/docs/zz-escaped/locked-asset.png)\n');
      const plan = await planAssetRename(studio.root, { path: asset, name: 'locked', baseMtime: await mtime(asset) });
      await chmod(file('content/docs/zz-a-locked'), 0o555);
      try {
        const failure: unknown = await applyAssetPlan(studio.root, plan).then(() => null, (error: unknown) => error);
        expect(failure).toMatchObject({ status: 500 });
        expect((failure as Error).message).toContain('nothing was changed');
      } finally {
        await chmod(file('content/docs/zz-a-locked'), 0o755);
      }
      expect(await exists(asset)).toBe(true);
      expect(await exists('public/docs/zz-escaped/locked.png')).toBe(false);
      await rm(file('content/docs/zz-a-locked'), { recursive: true });
    }, CORPUS_TIMEOUT_MS);

    it('lists usages in note and line order', async () => {
      const usages = (await find('public/docs/zz-escaped/foo-bar.png'))?.usages ?? [];
      expect(usages.map((usage) => usage.note)).toEqual([...usages.map((usage) => usage.note)].sort());
    });

    it('counts a broken note only for a name it holds whole', async () => {
      await writeFile(file('public/docs/zz-escaped/ta.png'), 'x');
      await writeFile(file('content/docs/zz-broken-name.mdx'), '<HtmlEmbed src="/docs/elsewhere/data.png"\n');
      expect((await find('public/docs/zz-escaped/ta.png'))?.usages).toEqual([]);
      await rm(file('content/docs/zz-broken-name.mdx'));
    });

    it('counts a reference it cannot place as unsure, which blocks delete', async () => {
      const asset = 'public/docs/zz-escaped/ta.png';
      await writeFile(file('content/docs/zz-unplaced.mdx'), '![a](/docs/zz-escaped/ta&period;png)\n');
      expect((await find(asset))?.usages).toMatchObject([{ note: 'content/docs/zz-unplaced.mdx', line: 1, unsure: true }]);
      expect((await post({ op: 'delete', path: asset, baseMtime: await mtime(asset) })).status).toBe(409);
      expect((await post({ op: 'rename', path: asset, name: 'tb', baseMtime: await mtime(asset) })).status).toBe(409);
      await rm(file('content/docs/zz-unplaced.mdx'));
    });

    it('refuses while a note that does not parse may use it', async () => {
      const broken = 'content/docs/zz-broken.mdx';
      await writeFile(file(broken), '<HtmlEmbed src="/docs/guide/using/studio-panes.svg"\n');
      expect((await find(PANES_SVG))?.usages.at(-1)).toMatchObject({ note: broken, line: 1, unsure: true });
      const response = await post({ op: 'rename', path: PANES_SVG, name: 'panes', baseMtime: await mtime(PANES_SVG) });
      expect(response.status).toBe(409);
      expect((json(response) as { error: string }).error).toContain(broken);
    });

    it('updates a note open in the editor through its sync', async () => {
      const note = REQUEST_PATH.note;
      const svg = REQUEST_PATH.asset;
      const client = createSyncClient({ transport: wsTransport(`ws://127.0.0.1:${studio.port}${SYNC_ENDPOINT}`) });
      try {
        const editor = new TextEditor();
        const doc = client.open(note.slice('content/docs/'.length), { editor });
        editor.text = (await doc.opened).text;
        const response = await post({ op: 'rename', path: svg, name: 'request-flow', baseMtime: await mtime(svg) });
        expect(response.status).toBe(200);
        await expect.poll(() => editor.external.at(-1) ?? '', { timeout: 5000 }).toContain('src="/docs/reference/architecture/request-flow.svg"');
        expect(doc.status()).toBe('synced');
      } finally {
        client.close();
      }
    });
  });

  describe('delete', () => {
    it('refuses while a note uses the asset, and lists where', async () => {
      const used = 'public/docs/guide/setup/sign-in-flow.webp';
      const dry = await post({ op: 'delete', dryRun: true, path: used, baseMtime: await mtime(used) });
      expect(dry.status).toBe(409);
      expect((json(dry) as { error: string }).error).toMatch(/content\/docs\/guide\/setup\.mdx/);
      expect((await post({ op: 'delete', path: used, baseMtime: await mtime(used) })).status).toBe(409);
      expect(await exists(used)).toBe(true);
    });

    it('deletes an unused asset and the folders it leaves empty', async () => {
      await writeFile(file('public/docs/demo/other.png'), 'x');
      const first = await post({ op: 'delete', path: 'public/docs/demo/pixel.png', baseMtime: await mtime('public/docs/demo/pixel.png') });
      expect(first.status).toBe(200);
      expect((json(first) as Answer).changes).toEqual([{ type: 'delete', path: 'public/docs/demo/pixel.png' }]);
      expect(await exists('public/docs/demo')).toBe(true);
      await rm(file('public/docs/demo/linked.jpg'));
      const rest = await post({ op: 'delete', path: 'public/docs/demo/other.png', baseMtime: await mtime('public/docs/demo/other.png') });
      expect(rest.status).toBe(200);
      expect(await exists('public/docs/demo')).toBe(false);
      expect(await exists('public/docs')).toBe(true);
    });

    it('deletes an unused asset a leftover regen script names', async () => {
      const response = await post({ op: 'delete', path: KEPT.asset, baseMtime: await mtime(KEPT.asset) });
      expect(response.status).toBe(200);
      expect(await exists(KEPT.asset)).toBe(false);
      expect(await exists(KEPT.script)).toBe(true);
    });

    it('refuses a stale delete', async () => {
      const unused = 'public/docs/guide/using/taken.svg';
      expect((await post({ op: 'delete', path: unused, baseMtime: (await mtime(unused)) - 1 })).status).toBe(409);
      expect(await exists(unused)).toBe(true);
    });
  });

  it('takes JSON only', async () => {
    const response = await rawRequest(`${studio.url}api/assets`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: studio.origin }, body: '{}' });
    expect(response.status).toBe(415);
  });
});
