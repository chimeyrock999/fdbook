import { chmod, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAssetPlan } from '../../../server/assets/ops';
import { planAssetReplace } from '../../../server/assets/replace';
import { repoRoot } from '../../../server/config';
import { lintWorktree } from '../../../server/lint/context';
import { MAX_ASSET_BYTES } from '../../../server/security/asset-types';
import { json, rawRequest } from '../../support/http';
import { generatedAsset, plantGeneratedAsset } from '../../support/generated-asset';
import { startTestStudio, type TestStudio } from '../../support/studio';

type Answer = { changes: { type: string; path: string; to?: string; detail?: string }[]; mtimeMs?: number };

const SUPERSET = 'public/notes/data-platform/stacks-integration/superset-trino-impersonate.jpg';
const SUPERSET_NOTE = 'content/notes/data-platform/stacks-integration/index.mdx';
const WAREHOUSE = 'public/notes/data-modeling/data_warehouse_architecture.webp';
// A generated asset the tests plant (support/generated-asset.ts).
const GENERATED = generatedAsset('made');
const NEW_BYTES = Buffer.from('new image bytes');

// Replacing an asset's content on a copy of the real content/notes,
// public/notes and diagrams. The tests run in order and build on each
// other's changes.
describe('assets API: replace', () => {
  let studio: TestStudio;

  const file = (path: string) => join(studio.root, path);
  const text = (path: string) => readFile(file(path), 'utf8');
  const exists = (path: string) => stat(file(path)).then(() => true, () => false);
  const mtime = async (path: string) => (await stat(file(path))).mtimeMs;
  const dryRun = (body: Record<string, unknown>) =>
    rawRequest(`${studio.url}api/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: studio.origin },
      body: JSON.stringify({ op: 'replace', dryRun: true, ...body }),
    });
  const put = (query: Record<string, string | number>, body: Buffer = NEW_BYTES, headers: Record<string, string> = { 'X-Studio-Write': '1' }) =>
    rawRequest(`${studio.url}api/assets?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString()}`, {
      method: 'PUT',
      headers: { Origin: studio.origin, ...headers },
      body,
    });
  // Every note's text, to show that a replace leaves the others byte for byte.
  const notes = async () => {
    const entries = await readdir(file('content/notes'), { recursive: true });
    const texts = new Map<string, string>();
    for (const entry of entries.filter((name) => name.endsWith('.mdx')).sort()) texts.set(entry, await text(`content/notes/${entry}`));
    return texts;
  };
  const missingAssets = async () =>
    (await lintWorktree(studio.root)).flatMap(({ path, issues }) => issues.filter((issue) => issue.rule === 'asset-missing').map((issue) => `${path} ${issue.message}`));

  beforeAll(async () => {
    studio = await startTestStudio();
    await cp(join(repoRoot, 'public/notes'), file('public/notes'), { recursive: true });
    await cp(join(repoRoot, 'diagrams'), file('diagrams'), { recursive: true });
    await plantGeneratedAsset(studio.root, 'made');
  });

  afterAll(async () => {
    await studio.close();
  });

  it('lists each asset with its size', async () => {
    const assets = (json(await rawRequest(`${studio.url}api/assets`)) as { assets: { path: string; size: number }[] }).assets;
    expect(assets.find((asset) => asset.path === SUPERSET)?.size).toBe((await stat(file(SUPERSET))).size);
  });

  it('shows a dry run with the same extension: only the file, and writes nothing', async () => {
    const before = await readFile(file(WAREHOUSE));
    const response = await dryRun({ path: WAREHOUSE, extension: 'webp', baseMtime: await mtime(WAREHOUSE) });
    expect(response.status).toBe(200);
    expect((json(response) as Answer).changes).toEqual([{ type: 'replace', path: WAREHOUSE, to: WAREHOUSE }]);
    expect(await readFile(file(WAREHOUSE))).toEqual(before);
  });

  it('replaces the content with the same extension and changes no note', async () => {
    const before = await notes();
    const response = await put({ path: WAREHOUSE, extension: 'webp', baseMtime: await mtime(WAREHOUSE) });
    expect(response.status).toBe(200);
    expect(await readFile(file(WAREHOUSE))).toEqual(NEW_BYTES);
    expect((json(response) as Answer).mtimeMs).toBe(await mtime(WAREHOUSE));
    expect(await notes()).toEqual(before);
  });

  it('takes the extension in any case', async () => {
    const response = await dryRun({ path: WAREHOUSE, extension: 'WEBP', baseMtime: await mtime(WAREHOUSE) });
    expect((json(response) as Answer).changes).toEqual([{ type: 'replace', path: WAREHOUSE, to: WAREHOUSE }]);
  });

  it('with another extension, moves the file and rewrites its references, leaving every other byte', async () => {
    const to = SUPERSET.replace(/\.jpg$/, '.webp');
    const dry = await dryRun({ path: SUPERSET, extension: 'webp', baseMtime: await mtime(SUPERSET) });
    expect((json(dry) as Answer).changes).toEqual([
      { type: 'replace', path: SUPERSET, to },
      { type: 'change', path: SUPERSET_NOTE, detail: '1 reference' },
    ]);
    const before = await notes();
    const response = await put({ path: SUPERSET, extension: 'webp', baseMtime: await mtime(SUPERSET) });
    expect(response.status).toBe(200);
    expect(await exists(SUPERSET)).toBe(false);
    expect(await readFile(file(to))).toEqual(NEW_BYTES);
    const after = await notes();
    const key = SUPERSET_NOTE.slice('content/notes/'.length);
    expect(after.get(key)).toBe(before.get(key)?.replace('superset-trino-impersonate.jpg', 'superset-trino-impersonate.webp'));
    after.delete(key);
    before.delete(key);
    expect(after).toEqual(before);
    expect(await missingAssets()).toEqual([]);
  }, 20_000);

  it('refuses a generated asset, and names its source', async () => {
    const before = await readFile(file(GENERATED.asset));
    const response = await put({ path: GENERATED.asset, extension: 'html', baseMtime: await mtime(GENERATED.asset) });
    expect(response.status).toBe(409);
    expect((json(response) as { error: string }).error).toMatch(/made\.architecture\.json, .*made\.regen\.sh generates made\.html/);
    expect((await dryRun({ path: GENERATED.asset, extension: 'html', baseMtime: await mtime(GENERATED.asset) })).status).toBe(409);
    expect(await readFile(file(GENERATED.asset))).toEqual(before);
  });

  it('refuses a type the Studio does not store, and a missing extension', async () => {
    const baseMtime = await mtime(WAREHOUSE);
    expect((await put({ path: WAREHOUSE, extension: 'exe', baseMtime })).status).toBe(400);
    expect((await put({ path: WAREHOUSE, extension: 'constructor', baseMtime })).status).toBe(400);
    expect((await dryRun({ path: WAREHOUSE, extension: '__proto__', baseMtime })).status).toBe(400);
    expect((await put({ path: WAREHOUSE, baseMtime })).status).toBe(400);
    expect((await dryRun({ path: WAREHOUSE, extension: 'txt', baseMtime })).status).toBe(400);
    expect(await readFile(file(WAREHOUSE))).toEqual(NEW_BYTES);
  });

  it('refuses a stale file, a taken name and paths outside public/notes', async () => {
    const pixel = 'public/notes/demo/pixel.png';
    const baseMtime = await mtime(pixel);
    expect((await put({ path: pixel, extension: 'png', baseMtime: baseMtime - 1000 })).status).toBe(409);
    expect((await put({ path: pixel, extension: 'png', baseMtime: 'abc' })).status).toBe(400);
    expect((await put({ path: pixel, extension: 'png', baseMtime: '' })).status).toBe(400);
    await writeFile(file('public/notes/demo/pixel.webp'), 'taken');
    expect((await put({ path: pixel, extension: 'webp', baseMtime })).status).toBe(409);
    expect((await put({ path: 'content/notes/index.mdx', extension: 'png', baseMtime })).status).toBe(403);
    expect((await put({ path: 'public/notes/nothing.png', extension: 'png', baseMtime })).status).toBe(404);
    expect(await readFile(file(pixel))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('refuses a stale replace before reading its bytes', async () => {
    const pixel = 'public/notes/demo/pixel.png';
    // Over the upload limit, but refused for its mtime first: 409, not 413.
    const response = await put({ path: pixel, extension: 'png', baseMtime: 1 }, Buffer.alloc(MAX_ASSET_BYTES + 1));
    expect(response.status).toBe(409);
    expect(await readFile(file(pixel))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('refuses a file over the upload limit, and a write without X-Studio-Write', async () => {
    const pixel = 'public/notes/demo/pixel.png';
    const baseMtime = await mtime(pixel);
    expect((await put({ path: pixel, extension: 'png', baseMtime }, Buffer.alloc(MAX_ASSET_BYTES + 1))).status).toBe(413);
    expect((await put({ path: pixel, extension: 'png', baseMtime }, NEW_BYTES, {})).status).toBe(415);
    expect((await rawRequest(`${studio.url}api/assets`, { method: 'DELETE', headers: { Origin: studio.origin } })).status).toBe(405);
    expect(await mtime(pixel)).toBe(baseMtime);
  });

  it('takes the content only through PUT', async () => {
    const pixel = 'public/notes/demo/pixel.png';
    const response = await rawRequest(`${studio.url}api/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: studio.origin },
      body: JSON.stringify({ op: 'replace', path: pixel, extension: 'png', baseMtime: await mtime(pixel) }),
    });
    expect(response.status).toBe(400);
  });

  it('removes the new file when the first note cannot be written', async () => {
    const asset = 'public/notes/zz-replace/locked-asset.png';
    await mkdir(file('public/notes/zz-replace'), { recursive: true });
    await writeFile(file(asset), 'old');
    await mkdir(file('content/notes/zz-replace-locked'));
    await writeFile(file('content/notes/zz-replace-locked/a.mdx'), '![a](/notes/zz-replace/locked-asset.png)\n');
    const plan = await planAssetReplace(studio.root, { path: asset, extension: 'webp', baseMtime: await mtime(asset) });
    await chmod(file('content/notes/zz-replace-locked'), 0o555);
    try {
      const failure: unknown = await applyAssetPlan(studio.root, plan, NEW_BYTES).then(() => null, (error: unknown) => error);
      expect(failure).toMatchObject({ status: 500 });
      expect((failure as Error).message).toContain('nothing was changed');
    } finally {
      await chmod(file('content/notes/zz-replace-locked'), 0o755);
    }
    expect(await text(asset)).toBe('old');
    expect(await exists('public/notes/zz-replace/locked-asset.webp')).toBe(false);
    await rm(file('content/notes/zz-replace-locked'), { recursive: true });
  });
});
