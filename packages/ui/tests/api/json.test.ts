import { describe, expect, it } from 'vitest';
import { errorOf, readJson, STALE_SERVER } from '#api/json.ts';
import { createTreeClient } from '#api/tree.ts';

describe('readJson', () => {
  it('reads JSON', async () => {
    const response = new Response('{"a":1}', { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    expect(await readJson<{ a: number }>(response)).toEqual({ a: 1 });
  });

  it("says to restart the Studio when an endpoint answers with the app's page", async () => {
    // What a server from before the endpoint existed answers: Vite's index.html.
    const page = () => new Response('<!doctype html><div id="root"></div>', { headers: { 'Content-Type': 'text/html' } });
    await expect(readJson(page())).rejects.toThrow(STALE_SERVER);
    const fetchPage = () => Promise.resolve(page());
    const original = globalThis.fetch;
    globalThis.fetch = fetchPage;
    try {
      await expect(createTreeClient().loadTree()).rejects.toThrow('npm run studio');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('reads the API error, or says to restart on a plain 404 from an older server', async () => {
    const api = new Response('{"error":"gone"}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    expect((await errorOf(api)).message).toBe('gone');
    expect((await errorOf(new Response('Not Found', { status: 404 }))).message).toBe(STALE_SERVER);
  });
});
