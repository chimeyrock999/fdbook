import { existsSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { createSyncServer, fsStorage } from '@fumadocs-editor/core/node';
import { atLeast } from '@fdbook/shared/auth.ts';
import { viewerOf } from '#auth/access.ts';
import { rejectForeignRequest } from '#security/guard.ts';
import { NOTES_DIR, resolveWorktreePath } from '#security/paths.ts';

// The fumadocs-editor sync server over content/notes: live documents that
// merge edits made on disk. Its paths are relative to content/notes; the
// same path check as the file API (policy plus no symlinks) decides what it
// may read and write, so `.md`, hidden files and anything outside the notes
// stay out. Its media endpoints are not mounted: assets go through the file
// API into public/. A `readOnly` sync (main) opens notes but writes none,
// and neither does a connection from someone signed in as a reader.
//
// The sync server asks for the scope once per connection and relays every
// update of an open document from then on, so each connection is watched
// (Viewer.watch) down to the role it was let in with: one whose viewer may
// no longer read, or no longer write, is closed. The client reconnects and
// meets the sign-in gate (#115), or comes back with its new scope, and the
// editor locks on `writable: false`.
//
// `onSaved` hears each note a person saved through it, as a worktree path,
// for an agent turn going on (agents/watch.ts).
export function createNotesSync(root: string, hosts: string[], { readOnly = false, onSaved }: { readOnly?: boolean; onSaved?: (path: string) => void } = {}) {
  const note = (path: string) => {
    const resolved = resolveWorktreePath(root, `${NOTES_DIR}/${path}`);
    return resolved?.kind === 'note' ? resolved.absolute : null;
  };
  // Writes only to notes that already exist. Its tree `create` would add a
  // page without touching meta.yaml, so new pages go through the file API
  // (#11). `mkdir` is refused by this scope too: since core 0.4.2 it also
  // needs write access to the folder's meta.json, which is not a note.
  const writable = (path: string) => {
    const absolute = note(path);
    return absolute !== null && existsSync(absolute);
  };
  const server = createSyncServer({
    // Its tree `delete` is the only caller of `storage.delete`, and the scope
    // cannot tell it from a save on the same path: refused here, since it
    // would leave meta.yaml as it was. Pages and folders are deleted through
    // the file API (#171).
    storage: { ...fsStorage(join(root, NOTES_DIR)), delete: (path) => Promise.reject(new Error(`delete denied: ${path}`)) },
    // The upgrade already passed the guard; checking again here keeps the
    // sync server safe even if it is mounted somewhere else later.
    authenticate: ({ request }) => {
      if (rejectForeignRequest(request, hosts)) return null;
      const viewer = viewerOf(request);
      const role = viewer.current();
      if (!atLeast(role, 'reader')) return null;
      // A writer is watched as a writer: turned reader, the connection
      // closes and comes back read only. On main nobody writes.
      const level = !readOnly && atLeast(role, 'writer') ? 'writer' : 'reader';
      const stop = viewer.watch(() => {
        for (const connection of server.connections()) if (connection.request === request) connection.close();
      }, level);
      // One request, one websocket: its socket ends with the connection.
      if (request.socket.destroyed) stop();
      else request.socket.once('close', stop);
      // Asked on every open and write too, so nothing waits for the next check.
      return {
        read: (path) => atLeast(viewer.current(), 'reader') && note(path) !== null,
        write: (path) => level === 'writer' && atLeast(viewer.current(), 'writer') && writable(path),
      };
    },
    setup: (sync) => (onSaved === undefined ? undefined : sync.onChange(({ path }) => { onSaved(`${NOTES_DIR}/${path}`); })),
  });
  return {
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
      // The gate and the change request lookup ran before: the browser may
      // have gone, or the session ended since. No connection exists yet.
      if (socket.destroyed || !atLeast(viewerOf(request).current(), 'reader')) {
        socket.destroy();
        return;
      }
      server.handleUpgrade(request, socket, head);
    },
    close: () => server.close(),
  };
}
