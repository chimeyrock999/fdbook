// Client for the Studio file API (server/files/api.ts, server/files/events.ts).

import { errorOf, readJson } from './json';

export type FileKind = 'note' | 'meta' | 'asset';
export type TextFile = { path: string; content: string; mtimeMs: number };
export type FileEntry = { path: string; kind: FileKind; mtimeMs: number };
export type FileEvent = { type: 'add' | 'change' | 'unlink'; path: string; mtimeMs: number | null };

// The save lost to a change made elsewhere. `disk` is what the file holds now
// (null when it was deleted); retry with `disk.mtimeMs` to keep your version.
export class FileConflictError extends Error {
  readonly path: string;
  readonly disk: { content: string | null; mtimeMs: number } | null;
  constructor(path: string, disk: { content: string | null; mtimeMs: number } | null) {
    super(`${path} changed on disk`);
    this.name = 'FileConflictError';
    this.path = path;
    this.disk = disk;
  }
}

export function createFilesClient(base = '') {
  const fileUrl = (path: string) => `${base}/api/file?path=${encodeURIComponent(path)}`;

  async function failed(response: Response): Promise<never> {
    throw await errorOf(response);
  }

  async function conflict(path: string, response: Response): Promise<never> {
    const body = (await response.json()) as { content: string | null; mtimeMs: number | null };
    throw new FileConflictError(path, body.mtimeMs === null ? null : { content: body.content, mtimeMs: body.mtimeMs });
  }

  const listeners = new Set<(event: FileEvent) => void>();
  let events: EventSource | null = null;

  return {
    async listFiles(): Promise<FileEntry[]> {
      const response = await fetch(`${base}/api/files`);
      if (!response.ok) return failed(response);
      return (await readJson<{ files: FileEntry[] }>(response)).files;
    },

    async readFile(path: string): Promise<TextFile> {
      const response = await fetch(fileUrl(path));
      if (!response.ok) return failed(response);
      return readJson<TextFile>(response);
    },

    // Saves a note or meta.yaml edited from `baseMtime` (null: a new file) and
    // returns the new mtime, or throws FileConflictError.
    async writeFile(path: string, content: string, baseMtime: number | null): Promise<number> {
      const response = await fetch(fileUrl(path), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, baseMtime }),
      });
      if (response.status === 409) return conflict(path, response);
      if (!response.ok) return failed(response);
      return (await readJson<{ mtimeMs: number }>(response)).mtimeMs;
    },

    async writeAsset(path: string, data: Blob, baseMtime: number | null): Promise<number> {
      const headers: Record<string, string> = { 'X-Studio-Write': '1' };
      if (baseMtime !== null) headers['X-Base-Mtime'] = String(baseMtime);
      const response = await fetch(fileUrl(path), { method: 'PUT', headers, body: data });
      if (response.status === 409) return conflict(path, response);
      if (!response.ok) return failed(response);
      return (await readJson<{ mtimeMs: number }>(response)).mtimeMs;
    },

    // Follows file changes on disk. The Studio's own saves arrive too: compare
    // the event's mtimeMs with the one writeFile returned to skip them. All
    // subscribers share one EventSource, closed with the last of them.
    subscribeFileEvents(listener: (event: FileEvent) => void): () => void {
      listeners.add(listener);
      events ??= new EventSource(`${base}/api/events`);
      events.onmessage = (message: MessageEvent<string>) => {
        const event = JSON.parse(message.data) as FileEvent;
        for (const each of [...listeners]) each(event);
      };
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          events?.close();
          events = null;
        }
      };
    },
  };
}

// A site path to a file under public/notes (`/notes/…/diagram.svg`, or
// without the leading slash, as lib/read-public-asset.ts reads it) as the
// file API URL that serves it; null for anything else, which the file API
// does not serve.
export function publicAssetUrl(src: string | undefined, base = ''): string | null {
  const path = src?.split(/[?#]/)[0].trim().replace(/^\/+/, '') ?? '';
  if (!path.startsWith('notes/') || /^[a-z]+:/i.test(src ?? '')) return null;
  return `${base}/api/file?path=${encodeURIComponent(`public/${path}`)}`;
}
