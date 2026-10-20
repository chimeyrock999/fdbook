import { watch, type FSWatcher } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import { pathnameOf, type Handler } from '../http.ts';
import { ASSETS_DIR, classifyPath, NOTES_DIR, resolveWorktreePath } from '../security/paths.ts';
import { listEditableFiles } from './store.ts';

export type FileEvent = { type: 'add' | 'change' | 'unlink'; path: string; mtimeMs: number | null };

const SETTLE_MS = 50;
const HEARTBEAT_MS = 25_000;

// Watches the editable areas of the worktree and streams changes as
// server-sent events on GET /api/events. Saves made by the Studio show up
// too; a client tells its own save apart by the mtime the save returned.
export function createFileEvents(root: string) {
  const clients = new Set<ServerResponse>();
  const known = new Map<string, number>();
  const pending = new Map<string, NodeJS.Timeout>();
  const watchers: FSWatcher[] = [];

  const broadcast = (event: FileEvent) => {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) client.write(frame);
  };

  const emitChange = async (path: string) => {
    const resolved = resolveWorktreePath(root, path);
    const info = resolved ? await stat(resolved.absolute).catch(() => null) : null;
    if (!info?.isFile()) {
      if (known.delete(path)) broadcast({ type: 'unlink', path, mtimeMs: null });
      return;
    }
    if (known.get(path) === info.mtimeMs) return;
    const type = known.has(path) ? 'change' : 'add';
    known.set(path, info.mtimeMs);
    broadcast({ type, path, mtimeMs: info.mtimeMs });
  };

  // fs.watch fires several raw events per save; settle, then stat once.
  const settle = (path: string) => {
    clearTimeout(pending.get(path));
    pending.set(
      path,
      setTimeout(() => {
        pending.delete(path);
        void emitChange(path);
      }, SETTLE_MS),
    );
  };

  // A folder renamed, moved or deleted reports only the folder: re-check the
  // files known under it and pick up the ones that now exist there.
  const folderChanged = async (dir: string) => {
    if (dir.split('/').some((segment) => segment.startsWith('.'))) return;
    for (const path of known.keys()) if (path.startsWith(`${dir}/`)) settle(path);
    const entries = await readdir(join(root, dir), { recursive: true }).catch(() => []);
    for (const entry of entries) {
      const path = `${dir}/${entry.split('\\').join('/')}`;
      if (classifyPath(path)) settle(path);
    }
  };

  for (const area of [NOTES_DIR, ASSETS_DIR]) {
    try {
      const watcher = watch(join(root, area), { recursive: true }, (_type, name) => {
        if (!name) return;
        const path = `${area}/${name.split('\\').join('/')}`;
        if (classifyPath(path)) settle(path);
        else void folderChanged(path);
      });
      watcher.on('error', () => undefined);
      watchers.push(watcher);
    } catch {
      // An area that does not exist yet has nothing to watch.
    }
  }

  // Current mtimes, so the first write to an existing file reads as a change.
  const ready = listEditableFiles(root)
    .then((files) => {
      for (const file of files) known.set(file.path, file.mtimeMs);
    })
    .catch(() => undefined);

  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(': heartbeat\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const handle: Handler = async (request, response) => {
    if (pathnameOf(request) !== '/api/events') return false;
    await ready;
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    response.write('retry: 1000\n\n');
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return true;
  };

  return {
    handle,
    close() {
      clearInterval(heartbeat);
      for (const timer of pending.values()) clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      for (const client of clients) client.end();
      clients.clear();
    },
  };
}
