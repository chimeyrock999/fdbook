import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO_PORT, parseStudioPort, startStudioServer, type StudioServer } from '../server/studio-server';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('studio server', () => {
  let studio: StudioServer;

  beforeAll(async () => {
    studio = await startStudioServer({ port: 0 });
  });

  afterAll(async () => {
    await studio.close();
  });

  it('binds to 127.0.0.1 only', () => {
    const address = studio.server.address() as AddressInfo;
    expect(address.address).toBe('127.0.0.1');
    expect(studio.url).toBe(`http://127.0.0.1:${String(address.port)}/`);
  });

  it('serves the app shell', async () => {
    const response = await fetch(studio.url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('/src/main.tsx');
  });

  it('serves shared site code but not the rest of the repo', async () => {
    const shared = await fetch(new URL(`/@fs${repoRoot}lib/notes-schema.ts`, studio.url));
    expect(shared.status).toBe(200);
    const other = await fetch(new URL(`/@fs${repoRoot}package.json`, studio.url));
    expect(other.status).toBe(403);
  });

  it('rejects a busy port without leaving a server behind', async () => {
    const { port } = studio.server.address() as AddressInfo;
    await expect(startStudioServer({ port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});

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
