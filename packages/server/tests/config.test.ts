import { describe, expect, it } from 'vitest';
import { DEFAULT_STALE_DAYS, DEFAULT_STUDIO_HOST, DEFAULT_STUDIO_PORT, listenFailure, parseStaleDays, parseStudioHost, parseStudioPort } from '#config.ts';

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

  it('returns an IPv6 address in the form browsers send', () => {
    expect(parseStudioHost('FD7A:115C:A1E0::1')).toBe('fd7a:115c:a1e0::1');
    expect(parseStudioHost('0:0:0:0:0:0:0:1')).toBe('::1');
  });

  it.each([
    '0.0.0.0',
    '::',
    '::0',
    '0::',
    '0:0:0:0:0:0:0:0',
    '::ffff:0.0.0.0',
    'fe80::1%en0',
    'localhost',
    'studio.example',
    '100.71.207',
  ])('rejects %s', (value) => {
    expect(() => parseStudioHost(value)).toThrow(/STUDIO_HOST/);
  });
});

describe('listenFailure', () => {
  const failure = (code: string) => Object.assign(new Error(`listen ${code}`), { code });

  it('names STUDIO_PORT for a busy port', () => {
    expect(listenFailure(failure('EADDRINUSE'), '127.0.0.1')).toMatch(/STUDIO_PORT/);
  });

  it('names STUDIO_HOST for an address the machine does not have', () => {
    expect(listenFailure(failure('EADDRNOTAVAIL'), '100.71.207.12')).toBe(
      'STUDIO_HOST 100.71.207.12 is not an address of this machine; is the interface up?',
    );
  });

  it('passes other errors through', () => {
    expect(listenFailure(failure('EACCES'), '127.0.0.1')).toBe('listen EACCES');
  });
});

describe('parseStaleDays', () => {
  it('uses 30 days when unset or empty', () => {
    expect(DEFAULT_STALE_DAYS).toBe(30);
    expect(parseStaleDays(undefined)).toBe(30);
    expect(parseStaleDays(' ')).toBe(30);
  });

  it('accepts a whole number of days', () => {
    expect(parseStaleDays(' 14 ')).toBe(14);
  });

  it.each(['0', '-3', '1.5', 'abc', '1e2'])('rejects %s', (value) => {
    expect(() => parseStaleDays(value)).toThrow(/STUDIO_STALE_DAYS/);
  });
});
