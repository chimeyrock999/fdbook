import { describe, expect, it } from 'vitest';
import { CR_SLUG_MAX, crSlug, isCrSlug } from '@fdbook/shared/cr-slug.ts';

describe('change request slugs', () => {
  it('slugs the name as kebab-case ASCII, Vietnamese marks dropped', () => {
    expect(crSlug('Sửa ghi chú Đường ống')).toBe('sua-ghi-chu-duong-ong');
  });

  it('keeps at most 24 characters and no dash at the end', () => {
    const slug = crSlug('Driver container notes for Databricks');
    expect(slug).toBe('driver-container-notes-f');
    expect(crSlug('abcdefghij abcdefghij abc def')).toBe('abcdefghij-abcdefghij-ab');
    expect(crSlug('abcdefghij abcdefghij ab-cdef')).toBe('abcdefghij-abcdefghij-ab');
    expect(crSlug('abcdefghij abcdefghijabc def')).toBe('abcdefghij-abcdefghijabc');
    expect(crSlug('abcdefghij abcdefghijab cdef')).toBe('abcdefghij-abcdefghijab');
  });

  it('adds -2, -3, … to a taken slug and stays within the limit', () => {
    expect(crSlug('Fix links', new Set(['fix-links']))).toBe('fix-links-2');
    expect(crSlug('Fix links', new Set(['fix-links', 'fix-links-2']))).toBe('fix-links-3');
    const long = crSlug('abcdefghij abcdefghij abcd', new Set(['abcdefghij-abcdefghij-ab']));
    expect(long).toBe('abcdefghij-abcdefghij-2');
    expect(long?.length).toBeLessThanOrEqual(CR_SLUG_MAX);
  });

  it('has no slug for a name without letters or digits', () => {
    expect(crSlug('  —  !!')).toBeNull();
  });

  it('tells a slug from anything else', () => {
    expect(isCrSlug('fix-links-2')).toBe(true);
    for (const value of ['', '_main', 'Fix', 'a--b', '-a', 'a-', 'a/b', 'x'.repeat(25)]) expect(isCrSlug(value)).toBe(false);
  });
});
