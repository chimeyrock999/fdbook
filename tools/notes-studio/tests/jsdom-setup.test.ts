// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

// No stub in this file: tests/setup/jsdom.ts gives every jsdom test what the
// window lacks, so a new test that renders the editor cannot miss it.
describe('jsdom setup', () => {
  it('answers matchMedia as a desktop with no preferences', () => {
    const query = window.matchMedia('(pointer: coarse)');
    expect(query.matches).toBe(false);
    expect(query.media).toBe('(pointer: coarse)');
    const onChange = () => undefined;
    query.addEventListener('change', onChange);
    query.removeEventListener('change', onChange);
    expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false);
  });
});
