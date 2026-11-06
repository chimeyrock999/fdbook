// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { assetChanged, assetUrl } from '#api/asset-versions.ts';
import { publicAssetUrl } from '#api/files.ts';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('asset versions', () => {
  it('adds the version once an asset changed, and points what shows it there', () => {
    const path = 'public/docs/guide/flow.png';
    const plain = '/api/file?path=public%2Fnotes%2Fguide%2Fflow.png';
    expect(assetUrl(path)).toBe(plain);
    document.body.innerHTML = `
      <img id="shown" src="${plain}">
      <iframe id="framed" src="${plain}"></iframe>
      <img id="longer" src="/api/file?path=public%2Fnotes%2Fguide%2Fflow.png.png">
      <img id="other" src="/api/file?path=public%2Fnotes%2Fguide%2Fother.png">`;
    assetChanged(path, 1234.5);
    expect(assetUrl(path)).toBe(`${plain}&v=1234.5`);
    expect(publicAssetUrl('/docs/guide/flow.png')).toBe(`${plain}&v=1234.5`);
    expect(document.getElementById('shown')?.getAttribute('src')).toBe(`${plain}&v=1234.5`);
    expect(document.getElementById('framed')?.getAttribute('src')).toBe(`${plain}&v=1234.5`);
    expect(document.getElementById('longer')?.getAttribute('src')).toBe('/api/file?path=public%2Fnotes%2Fguide%2Fflow.png.png');
    expect(document.getElementById('other')?.getAttribute('src')).toBe('/api/file?path=public%2Fnotes%2Fguide%2Fother.png');
    assetChanged(path, 2000);
    expect(document.getElementById('shown')?.getAttribute('src')).toBe(`${plain}&v=2000`);
  });
});
