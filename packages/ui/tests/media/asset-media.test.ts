import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFilesClient } from '#api/files.ts';
import { createAssetMedia, UploadCancelled, type NameRequest, type UploadNotice } from '#media/asset-media.ts';
import { startTestStudio, type TestStudio } from '@fdbook/testing/studio.ts';

const NOTE = 'content/docs/data-modeling/index.mdx';
const png = (name: string, bytes = [0x89, 0x50, 0x4e, 0x47]) => new File([new Uint8Array(bytes)], name, { type: 'image/png' });

describe('asset media provider', () => {
  let studio: TestStudio;
  let files: ReturnType<typeof createFilesClient>;

  beforeAll(async () => {
    studio = await startTestStudio();
    files = createFilesClient(studio.origin);
  });

  afterAll(async () => {
    await studio.close();
  });

  function media(answer: (request: NameRequest) => string | null) {
    const requests: NameRequest[] = [];
    const notices: (UploadNotice | null)[] = [];
    const provider = createAssetMedia({
      files,
      notePath: NOTE,
      base: studio.origin,
      askName: (request) => {
        requests.push(request);
        return Promise.resolve(answer(request));
      },
      notify: (notice) => notices.push(notice),
    });
    return { provider, requests, notices };
  }

  it('saves under the page folder with the chosen name and returns the site path', async () => {
    const { provider, requests, notices } = media(() => 'warehouse-layers');
    const src = await provider.upload(png('Ảnh chụp màn hình.PNG'));
    expect(src).toBe('/docs/data-modeling/warehouse-layers.png');
    expect(requests).toEqual([
      expect.objectContaining({ dir: 'public/docs/data-modeling', stem: 'anh-chup-man-hinh', extension: 'png' }),
    ]);
    expect([...(await readFile(join(studio.root, 'public/docs/data-modeling/warehouse-layers.png')))]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(notices).toEqual([{ kind: 'busy', text: 'Uploading warehouse-layers.png…' }, null]);
  });

  it('writes nothing when the name is cancelled', async () => {
    const { provider } = media(() => null);
    await expect(provider.upload(png('cancelled.png'))).rejects.toBeInstanceOf(UploadCancelled);
    await expect(readFile(join(studio.root, 'public/docs/data-modeling/cancelled.png'))).rejects.toThrow(/ENOENT/);
  });

  it('never overwrites a file that appeared after the name was picked', async () => {
    await mkdir(join(studio.root, 'public/docs/data-modeling'), { recursive: true });
    await writeFile(join(studio.root, 'public/docs/data-modeling/taken.png'), 'theirs');
    const { provider } = media(() => 'taken');
    await expect(provider.upload(png('mine.png'))).rejects.toThrow('taken.png already exists on this page. Upload it again under another name.');
    expect(await readFile(join(studio.root, 'public/docs/data-modeling/taken.png'), 'utf8')).toBe('theirs');
  });

  it('refuses a type the site cannot serve before asking for a name', async () => {
    const { provider, requests } = media(() => 'never');
    const heic = new File([new Uint8Array([1])], 'IMG_2041.heic', { type: 'image/heic' });
    await expect(provider.upload(heic)).rejects.toThrow('IMG_2041.heic: the site cannot serve .heic. Use PNG, JPEG, WebP, GIF, AVIF or SVG.');
    expect(requests).toEqual([]);
  });

  it('refuses a file over the Studio\'s size limit', async () => {
    const { provider, requests } = media(() => 'never');
    const big = png('big.png');
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    await expect(provider.upload(big)).rejects.toThrow('big.png is larger than 25 MB, the most the Studio saves.');
    expect(requests).toEqual([]);
  });

  it('reports failures but stays quiet on a cancel', () => {
    const { provider, notices } = media(() => null);
    provider.onError?.(new UploadCancelled(), png('a.png'));
    provider.onError?.(new Error('disk full'), png('b.png'));
    expect(notices).toEqual([{ kind: 'error', text: 'disk full' }]);
  });

  it('does not clear what another upload reports', async () => {
    // Image B is uploading when image A's upload fails; B then finishes.
    let shown: UploadNotice | null = null;
    const provider = createAssetMedia({
      files,
      notePath: NOTE,
      base: studio.origin,
      askName: () => Promise.resolve('second'),
      notify: (notice, replacing) => {
        if (replacing === undefined || shown === replacing) shown = notice;
        if (notice?.kind === 'busy') provider.onError?.(new Error('first.png failed'), png('first.png'));
      },
    });
    await provider.upload(png('second.png'));
    expect(shown).toEqual({ kind: 'error', text: 'first.png failed' });
  });

  it('shows site paths through the file API and leaves other sources alone', () => {
    const { provider } = media(() => null);
    expect(provider.resolve?.('/docs/demo/pixel.png')).toBe(`${studio.origin}/api/file?path=public%2Fdocs%2Fdemo%2Fpixel.png`);
    expect(provider.resolve?.('https://example.com/x.png')).toBe('https://example.com/x.png');
  });
});
