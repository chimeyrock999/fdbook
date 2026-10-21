import { describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO_HOST, DEFAULT_STUDIO_PORT, parseStudioHost, parseStudioPort } from '../../server/config';

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

describe('parseStudioHost', () => {
  it('uses 127.0.0.1 when unset or empty', () => {
    expect(parseStudioHost(undefined)).toBe(DEFAULT_STUDIO_HOST);
    expect(parseStudioHost(' ')).toBe(DEFAULT_STUDIO_HOST);
  });

  it('accepts an IP address', () => {
    expect(parseStudioHost(' 100.71.207.12 ')).toBe('100.71.207.12');
    expect(parseStudioHost('fd7a::1')).toBe('fd7a::1');
  });

  it.each(['0.0.0.0', '::', 'localhost', 'studio.example', '100.71.207'])('rejects %s', (value) => {
    expect(() => parseStudioHost(value)).toThrow(/STUDIO_HOST/);
  });
});
