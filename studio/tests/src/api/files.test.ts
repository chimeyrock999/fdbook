import { readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFilesClient, FileConflictError, publicAssetUrl } from '../../../src/api/files';
import { startTestStudio, type TestStudio } from '../../support/studio';

describe('files client', () => {
  let studio: TestStudio;
  let client: ReturnType<typeof createFilesClient>;

  beforeAll(async () => {
    studio = await startTestStudio();
    client = createFilesClient(studio.url.slice(0, -1));
  });

  afterAll(async () => {
    await studio.close();
  });

  it('lists, reads and saves', async () => {
    const files = await client.listFiles();
    expect(files.some((file) => file.path === 'content/docs/index.mdx' && file.kind === 'note')).toBe(true);
    const file = await client.readFile('content/docs/streaming/meta.yaml');
    const mtimeMs = await client.writeFile(file.path, `${file.content}# saved\n`, file.mtimeMs);
    expect(mtimeMs).not.toBe(file.mtimeMs);
    expect(await readFile(join(studio.root, file.path), 'utf8')).toBe(`${file.content}# saved\n`);
  });

  it('throws FileConflictError with the disk version', async () => {
    const file = await client.readFile('content/docs/database/index.mdx');
    const absolute = join(studio.root, file.path);
    await writeFile(absolute, 'edited in obsidian\n');
    await utimes(absolute, new Date(), new Date(file.mtimeMs + 5000));
    const error = await client.writeFile(file.path, 'mine', file.mtimeMs).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(FileConflictError);
    expect((error as FileConflictError).disk?.content).toBe('edited in obsidian\n');

    await rm(absolute);
    const gone = await client.writeFile(file.path, 'mine', file.mtimeMs).catch((reason: unknown) => reason);
    expect((gone as FileConflictError).disk).toBeNull();
  });

  it('saves assets and reports their conflicts', async () => {
    const path = 'public/docs/demo/client.png';
    const mtimeMs = await client.writeAsset(path, new Blob([new Uint8Array([1, 2])]), null);
    await expect(client.writeAsset(path, new Blob([new Uint8Array([3])]), null)).rejects.toBeInstanceOf(FileConflictError);
    await client.writeAsset(path, new Blob([new Uint8Array([3])]), mtimeMs);
    expect([...(await readFile(join(studio.root, path)))]).toEqual([3]);
  });

  it('surfaces the server error for a refused path', async () => {
    await expect(client.readFile('package.json')).rejects.toThrow(/not an editable path/);
  });

  // How the SvgDiagram plugin shows a site path such as /docs/….svg.
  it('serves a site path under public/', async () => {
    const url = publicAssetUrl('/docs/demo/pixel.png?v=1#x', studio.origin);
    expect(url).toBe(`${studio.origin}/api/file?path=public%2Fnotes%2Fdemo%2Fpixel.png`);
    const response = await fetch(url ?? '');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(publicAssetUrl('notes/demo/pixel.png')).toBe('/api/file?path=public%2Fnotes%2Fdemo%2Fpixel.png');
    // The file API serves public/docs only.
    expect([undefined, '', '/images/x.svg', 'https://cdn/notes/x.svg', '//cdn/x.svg'].map((src) => publicAssetUrl(src)))
      .toEqual([null, null, null, null, null]);
  });
});
