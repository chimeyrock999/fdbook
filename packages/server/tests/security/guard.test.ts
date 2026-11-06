import type { IncomingMessage } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ownHosts, rejectForeignRequest } from '#security/guard.ts';
import { rawRequest } from '#tests/support/http.ts';
import { startTestStudio, type TestStudio } from '@fdbook/testing/studio.ts';

// The guard runs before every handler; these go through the real server.
// Websocket upgrades are covered in routing.test.ts.
describe('origin guard', () => {
  let studio: TestStudio;
  const note = () => studio.fileUrl('content/docs/index.mdx');
  const putNote = (headers: Record<string, string>) =>
    rawRequest(studio.fileUrl('content/docs/x.mdx'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ content: 'x', baseMtime: null }),
    });

  beforeAll(async () => {
    studio = await startTestStudio();
  });

  afterAll(async () => {
    await studio.close();
  });

  it('refuses a foreign Origin', async () => {
    expect((await putNote({ Origin: 'http://evil.example' })).status).toBe(403);
    expect((await rawRequest(note(), { headers: { Origin: 'http://evil.example' } })).status).toBe(403);
  });

  it('refuses another local port', async () => {
    expect((await putNote({ Origin: 'http://localhost:3000' })).status).toBe(403);
  });

  it('refuses a rebound Host (DNS rebinding), on the API and the app shell', async () => {
    const headers = { Host: `evil.example:${studio.port}` };
    expect((await rawRequest(note(), { headers })).status).toBe(403);
    expect((await rawRequest(studio.url, { headers })).status).toBe(403);
  });

  it('refuses cross-site fetch metadata', async () => {
    expect((await rawRequest(note(), { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect((await rawRequest(`${studio.url}api/events`, { headers: { 'Sec-Fetch-Site': 'same-site' } })).status).toBe(403);
  });

  it('refuses writes a page could send without a preflight', async () => {
    expect((await putNote({ 'Content-Type': 'text/plain' })).status).toBe(415);
    const asset = await rawRequest(studio.fileUrl('public/docs/demo/x.png'), {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: Buffer.from([1]),
    });
    expect(asset.status).toBe(415);
  });

  it('accepts its own origin, localhost and requests without an Origin', async () => {
    expect((await rawRequest(note(), { headers: { Origin: studio.origin, 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(
      200,
    );
    expect((await rawRequest(note(), { headers: { Host: `localhost:${studio.port}` } })).status).toBe(200);
    expect((await rawRequest(note())).status).toBe(200);
  });
});

describe('own hosts', () => {
  const request = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;

  it('answers to 127.0.0.1 and localhost on loopback', () => {
    expect(ownHosts('127.0.0.1', 4310)).toEqual(['127.0.0.1:4310', 'localhost:4310']);
  });

  it('answers only to the address it is bound to elsewhere', () => {
    const hosts = ownHosts('100.71.207.12', 4310);
    expect(rejectForeignRequest(request({ host: '100.71.207.12:4310', origin: 'http://100.71.207.12:4310' }), hosts)).toBeNull();
    expect(rejectForeignRequest(request({ host: 'localhost:4310' }), hosts)).toBe('unexpected Host header');
    expect(rejectForeignRequest(request({ host: '100.71.207.12:4310', origin: 'http://evil.example' }), hosts)).toBe('foreign Origin');
  });

  it('brackets an IPv6 address', () => {
    expect(ownHosts('fd7a::1', 4310)).toEqual(['[fd7a::1]:4310']);
  });

  it('answers to the form of an IPv6 address browsers send', () => {
    expect(ownHosts('FD7A:115C:A1E0::1', 4310)).toEqual(['[fd7a:115c:a1e0::1]:4310']);
    expect(ownHosts('::ffff:100.71.207.12', 4310)).toEqual(['[::ffff:6447:cf0c]:4310']);
  });
});
