import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { repoRoot } from '../../server/config';
import { startStudioServer, type StudioServer } from '../../server/studio-server';

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

  it('answers an unknown API path with JSON, not the app shell', async () => {
    for (const path of ['/api/nothing', '/api', '/api/tree/extra']) {
      const response = await fetch(new URL(path, studio.url));
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(((await response.json()) as { error: string }).error).toBe(`no such Studio API: ${path}`);
    }
    // Paths that only start with "api" are still the app's.
    expect((await fetch(new URL('/apis', studio.url))).headers.get('content-type')).toContain('text/html');
  });

  it('rejects a busy port without leaving a server behind', async () => {
    const { port } = studio.server.address() as AddressInfo;
    await expect(startStudioServer({ port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});
