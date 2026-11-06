import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { git } from '../../support/git';
import { json, rawRequest } from '../../support/http';
import { startTestStudio, type TestStudio } from '../../support/studio';

type Side = { kind: 'text'; text: string; size: number } | { kind: 'binary'; size: number };
type Version = { sha: string; path: string; status: string; from?: string };
type History = { path: string; mtimeMs: number | null; deleted: unknown; versions: Version[] };

const PNG = 'public/docs/demo/pixel.png';
const WEBP = 'public/docs/demo/pixel.webp';
const SVG = 'public/docs/demo/shape.svg';
const NOTE = 'content/docs/streaming/asset-history.mdx';
const v1 = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const v2 = Buffer.from('second pixel bytes');
const v3 = Buffer.from('third pixel, as webp');

// An asset's history (#114) through the real server, on a git worktree: the
// pixel is changed, then renamed to .webp with the note that uses it, in
// the change request. The tests run in order.
describe('page history API: assets', () => {
  let studio: TestStudio;
  let first: string;
  let second: string;
  let renamed: string;
  let third: string;
  let shapes: string[];

  const at = (path: string) => join(studio.root, path);
  const mtimeOf = async (path: string) => (await stat(at(path))).mtimeMs;
  const commit = (message: string) => {
    git(studio.root, 'add', '-A');
    git(studio.root, 'commit', '--quiet', '-m', message);
    return git(studio.root, 'rev-parse', 'HEAD').trim();
  };
  const historyOf = async (path: string) => {
    const response = await rawRequest(`${studio.url}api/history?${new URLSearchParams({ path }).toString()}`);
    expect(response.status).toBe(200);
    return json(response) as History;
  };
  const compare = (query: Record<string, string>) => rawRequest(`${studio.url}api/history/compare?${new URLSearchParams(query).toString()}`);
  const restore = (body: unknown) =>
    rawRequest(`${studio.url}api/history/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: studio.origin },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    studio = await startTestStudio({ git: true });
    first = git(studio.root, 'rev-parse', 'HEAD').trim();
    await writeFile(at(NOTE), '---\ntitle: Asset history\n---\n\n![Pixel](/docs/demo/pixel.png)\n');
    await writeFile(at(PNG), v2);
    second = commit('docs: second pixel');
    // Git follows a rename only while the content stays alike: the bytes change after.
    git(studio.root, 'mv', PNG, WEBP);
    await writeFile(at(NOTE), '---\ntitle: Asset history\n---\n\n![Pixel](/docs/demo/pixel.webp)\n');
    renamed = commit('docs: pixel as webp');
    await writeFile(at(WEBP), v3);
    third = commit('docs: third pixel');
    await mkdir(at('public/docs/demo'), { recursive: true });
    shapes = [];
    for (const size of [10, 20]) {
      await writeFile(at(SVG), `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}"/>`);
      shapes.push(commit(`docs: shape ${String(size)}`));
    }
  });
  afterAll(async () => {
    await studio.close();
  });

  it('lists an asset versions across its rename, and compares them by size', async () => {
    const history = await historyOf(WEBP);
    expect(history.mtimeMs).toBe(await mtimeOf(WEBP));
    expect(history.deleted).toBeNull();
    expect(history.versions.map(({ sha, path, status, from }) => ({ sha, path, status, from }))).toEqual([
      { sha: third, path: WEBP, status: 'M', from: undefined },
      { sha: renamed, path: WEBP, status: 'R', from: PNG },
      { sha: second, path: PNG, status: 'M', from: undefined },
      { sha: first, path: PNG, status: 'A', from: undefined },
    ]);
    const response = await compare({ path: WEBP, from: first, to: 'now' });
    expect(response.status).toBe(200);
    expect(json(response)).toMatchObject({
      from: { version: first, path: PNG },
      to: { version: 'now', path: WEBP },
      before: { kind: 'binary', size: v1.length } satisfies Side,
      after: { kind: 'binary', size: v3.length } satisfies Side,
    });
  });

  it('compares an SVG as text', async () => {
    const response = await compare({ path: SVG, from: shapes[0], to: shapes[1] });
    const { before, after } = json(response) as { before: Side; after: Side };
    expect([before, after].map((side) => (side.kind === 'text' ? /width="(\d+)"/.exec(side.text)?.[1] : side.kind))).toEqual(['10', '20']);
  });

  it('serves the image of a version through the blob endpoint', async () => {
    const response = await rawRequest(`${studio.url}api/changes/blob?${new URLSearchParams({ path: PNG, base: second }).toString()}`);
    expect(response.status).toBe(200);
    expect(Buffer.from(response.body)).toEqual(v2);
  });

  it('restores a version with the same extension over the file, notes untouched', async () => {
    const response = await restore({ path: SVG, sha: shapes[0], mtimeMs: await mtimeOf(SVG) });
    expect(response.status).toBe(200);
    expect(json(response)).toEqual({ path: SVG, mtimeMs: await mtimeOf(SVG) });
    expect(await readFile(at(SVG), 'utf8')).toContain('width="10"');
  });

  it('restores a version with another extension as Replace does: the file and every link follow', async () => {
    const response = await restore({ path: WEBP, sha: second, mtimeMs: await mtimeOf(WEBP) });
    expect(response.status).toBe(200);
    expect(json(response)).toEqual({ path: PNG, mtimeMs: await mtimeOf(PNG) });
    expect(await readFile(at(PNG))).toEqual(v2);
    await expect(stat(at(WEBP))).rejects.toThrow();
    expect(await readFile(at(NOTE), 'utf8')).toContain('](/docs/demo/pixel.png)');
  });

  it('restores an asset a leftover regen script names', async () => {
    const legacy = 'public/docs/demo/legacy.svg';
    await mkdir(at('diagrams'), { recursive: true });
    await writeFile(at('diagrams/demo.regen.sh'), `OUT=${legacy}\n`);
    await writeFile(at(legacy), '<svg xmlns="http://www.w3.org/2000/svg" width="1"/>');
    const made = commit('docs: a legacy shape');
    await writeFile(at(legacy), '<svg xmlns="http://www.w3.org/2000/svg" width="2"/>');
    commit('docs: the legacy shape again');
    expect(Object.keys(await historyOf(legacy)).sort()).toEqual(['deleted', 'mtimeMs', 'path', 'versions']);
    const response = await restore({ path: legacy, sha: made, mtimeMs: await mtimeOf(legacy) });
    expect(response.status).toBe(200);
    expect(await readFile(at(legacy), 'utf8')).toContain('width="1"');
  });

  it('refuses a stale asset, and still refuses a meta.yaml', async () => {
    const response = await restore({ path: PNG, sha: first, mtimeMs: (await mtimeOf(PNG)) - 1000 });
    expect(response.status).toBe(409);
    expect((await rawRequest(`${studio.url}api/history?path=${encodeURIComponent('content/docs/meta.yaml')}`)).status).toBe(403);
  });
});
