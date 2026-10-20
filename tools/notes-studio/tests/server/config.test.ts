import { describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO_PORT, parseStudioPort } from '../../server/config';

describe('parseStudioPort', () => {
  it('uses the default port when unset or empty', () => {
    expect(parseStudioPort(undefined)).toBe(DEFAULT_STUDIO_PORT);
    expect(parseStudioPort('')).toBe(DEFAULT_STUDIO_PORT);
    expect(parseStudioPort('  ')).toBe(DEFAULT_STUDIO_PORT);
  });

  it('accepts a valid port', () => {
    expect(parseStudioPort('5000')).toBe(5000);
  });

  it.each(['abc', '0', '65536', '43.1', '-1', '0x1F', '1e3', '0b11', '5000.0'])('rejects %s', (value) => {
    expect(() => parseStudioPort(value)).toThrow(/STUDIO_PORT/);
  });
});
