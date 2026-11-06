import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SYNC_ENDPOINT } from '@fumadocs-editor/core/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestListener } from '../../server/routing';
import { ownHosts } from '../../server/security/guard';
import { rawRequest, tryUpgrade } from '../support/http';
import { startTestStudio, type TestStudio } from '../support/studio';

describe('websocket upgrades', () => {
  let studio: TestStudio;
  const syncUrl = () => `${studio.origin}${SYNC_ENDPOINT}`;

  beforeAll(async () => {
    studio = await startTestStudio();
  });

  afterAll(async () => {
    await studio.close();
  });

  it('accepts the sync socket from the Studio origin', async () => {
    expect(await tryUpgrade(syncUrl(), { Origin: studio.origin })).toBe('upgraded');
  });

  it('keeps Vite HMR working', async () => {
    expect(await tryUpgrade(studio.url, { 'Sec-WebSocket-Protocol': 'vite-ping' })).toBe('upgraded');
  });

  it('refuses a foreign Origin or a rebound Host', async () => {
    expect(await tryUpgrade(syncUrl(), { Origin: 'http://evil.example' })).toBe('refused 403');
    expect(await tryUpgrade(syncUrl(), { Host: `evil.example:${studio.port}` })).toBe('refused 403');
    expect(await tryUpgrade(studio.url, { Origin: 'http://evil.example', 'Sec-WebSocket-Protocol': 'vite-hmr' })).toBe(
      'refused 403',
    );
  });

  it('lets no cross-site page load through while sign-in is off, not even the sign-in callback', async () => {
    const response = await rawRequest(`${studio.origin}/api/session/callback?code=x&state=y`, { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' } });
    expect(response.status).toBe(403);
  });

  it('closes upgrades nobody handles instead of leaving them open', async () => {
    expect(await tryUpgrade(`${studio.url}somewhere`)).toBe('refused 404');
    // Vite would ignore its protocol on another path and leave the socket open.
    expect(await tryUpgrade(`${studio.url}somewhere`, { 'Sec-WebSocket-Protocol': 'vite-hmr' })).toBe('refused 404');
  });
});

describe('request listener', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    url = `http://127.0.0.1:${String(port)}/`;
    const failing = () => Promise.reject(new Error('disk on fire'));
    server.on(
      'request',
      createRequestListener(ownHosts('127.0.0.1', port), [failing], (_request, response) => response.end('fallback')),
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => {
      resolve();
    }));
  });

  it('answers 500 when a handler fails instead of crashing', async () => {
    const response = await rawRequest(url);
    expect(response.status).toBe(500);
    expect(response.body.toString()).toContain('disk on fire');
  });
});
