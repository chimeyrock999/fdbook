import { describe, expect, it } from 'vitest';
import { previewUrlOf } from '#services/preview/preview.ts';

describe('preview URL', () => {
  it('reads the Cloudflare Pages preview URL off the branch', () => {
    expect(previewUrlOf('cr/fix-links', 'chimey')).toBe('https://cr-fix-links.chimey.pages.dev');
    expect(previewUrlOf(`cr/${'a'.repeat(24)}`, 'chimey')).toBe(`https://cr-${'a'.repeat(24)}.chimey.pages.dev`);
  });
});
