import { describe, expect, it } from 'vitest';
import { assetDirFor, imageExtension, sitePath, suggestedStem } from '#media/asset-names.ts';
import { slugify } from '@fdbook/shared/slug.ts';

describe('asset names', () => {
  // The folder the site's notes already use: the page slug, and a folder's
  // index page uses the folder (public/docs/data-modeling/… for
  // content/docs/data-modeling/index.mdx).
  it('puts a page\'s assets in the folder named after its slug', () => {
    expect(assetDirFor('content/docs/data-modeling/dimensional-modeling/dimensional-modeling-in-practice/retail-sales.mdx'))
      .toBe('public/docs/data-modeling/dimensional-modeling/dimensional-modeling-in-practice/retail-sales');
    expect(assetDirFor('content/docs/data-modeling/index.mdx')).toBe('public/docs/data-modeling');
    expect(assetDirFor('content/docs/index.mdx')).toBe('public/docs');
  });

  it('writes the site path of a saved asset', () => {
    expect(sitePath('public/docs/data-modeling/bus-matrix.png')).toBe('/docs/data-modeling/bus-matrix.png');
  });

  it('turns any name into a kebab-case ASCII stem', () => {
    expect(slugify('Ảnh chụp màn hình 2026-10-21 lúc 14.32')).toBe('anh-chup-man-hinh-2026-10-21-luc-14-32');
    expect(slugify('Đường đi  của DATA__flow')).toBe('duong-di-cua-data-flow');
    expect(slugify('  --  ')).toBe('');
  });

  it('suggests the file\'s own name without its extension', () => {
    expect(suggestedStem('Bus Matrix Example.PNG')).toBe('bus-matrix-example');
    expect(suggestedStem('image.png')).toBe('image');
    expect(suggestedStem('.png')).toBe('image');
    expect(suggestedStem('数据.png')).toBe('image');
  });

  it('keeps an extension the site serves, else reads it from the type', () => {
    expect(imageExtension({ name: 'shot.PNG', type: 'image/png' })).toBe('png');
    expect(imageExtension({ name: 'photo.jpeg', type: 'image/jpeg' })).toBe('jpeg');
    expect(imageExtension({ name: 'image', type: 'image/jpeg' })).toBe('jpg');
    expect(imageExtension({ name: 'diagram', type: 'image/svg+xml' })).toBe('svg');
    expect(imageExtension({ name: 'clip.png.webp', type: '' })).toBe('webp');
    // A dot in the name that is no image extension: the type decides.
    expect(imageExtension({ name: 'Screen Shot 10.21', type: 'image/png' })).toBe('png');
    expect(imageExtension({ name: 'diagram.v2', type: 'image/svg+xml' })).toBe('svg');
  });

  it('refuses images the site cannot serve', () => {
    expect(imageExtension({ name: 'IMG_2041.heic', type: 'image/heic' })).toBeNull();
    expect(imageExtension({ name: 'scan.tiff', type: 'image/tiff' })).toBeNull();
    // Assets that are not images go through other components, not an image node.
    expect(imageExtension({ name: 'page.html', type: 'text/html' })).toBeNull();
    expect(imageExtension({ name: 'notes.v2', type: '' })).toBeNull();
  });
});
