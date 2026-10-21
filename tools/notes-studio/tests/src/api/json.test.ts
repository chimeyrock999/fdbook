import { describe, expect, it } from 'vitest';
import { readJson, STALE_SERVER } from '../../../src/api/json';
import { createTreeClient } from '../../../src/api/tree';

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
});
