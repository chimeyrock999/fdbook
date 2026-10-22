import { createSyncClient, SYNC_ENDPOINT, wsTransport, type DocumentEditor } from '@fumadocs-editor/core/sync';

// A plain-text editor for a synced document. `received` is every text the
// server pushed into it after it opened.
export class TextEditor implements DocumentEditor {
  text = '';
  received: string[] = [];
  getMarkdown() {
    return this.text;
  }
  applyExternalMarkdown(text: string) {
    this.text = text;
    this.received.push(text);
    return Promise.resolve([]);
  }
  setMarkdown(text: string) {
    this.text = text;
    return Promise.resolve();
  }
  markSaved() {
    // keeps no base
  }
}

const NativeWebSocket = globalThis.WebSocket;

// Opens the notes sync at `origin` (under `base`, /cr/<slug> for a change
// request) as the browser would, with the session cookie. The client
// connects at once; the global goes back to the native WebSocket after, even
// when two are opened in one tick.
export function syncWith(origin: string, cookie: string, base = '') {
  class WithCookie extends NativeWebSocket {
    constructor(url: string | URL) {
      // undici's WebSocket takes headers in its init; browsers send the cookie themselves.
      super(url, { headers: { Cookie: cookie, Origin: origin } } as unknown as string[]);
    }
  }
  globalThis.WebSocket = WithCookie;
  try {
    return createSyncClient({ transport: wsTransport(`${origin.replace(/^http/, 'ws')}${base}${SYNC_ENDPOINT}`) });
  } finally {
    queueMicrotask(() => { globalThis.WebSocket = NativeWebSocket; });
  }
}
