import { existsSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { createSyncServer } from '@fumadocs-editor/core/node';
import { atLeast } from '../auth/shared.ts';
import { viewerOf } from '../security/access.ts';
import { rejectForeignRequest } from '../security/guard.ts';
import { NOTES_DIR, resolveWorktreePath } from '../security/paths.ts';

// The fumadocs-editor sync server over content/notes: live documents that
// merge edits made on disk. Its paths are relative to content/notes; the
// same path check as the file API (policy plus no symlinks) decides what it
// may read and write, so `.md`, hidden files and anything outside the notes
// stay out. Its media endpoints are not mounted: assets go through the file
// API into public/. A `readOnly` sync (main) opens notes but writes none,
// and neither does a connection from someone signed in as a reader.
// The sync server asks `read` only when a document opens, then relays every
// update of it: a socket is closed once its viewer may no longer read
// (Viewer.watch), and its reconnect meets the sign-in gate (#115).
export function createNotesSync(root: string, hosts: string[], { readOnly = false } = {}) {
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
    root: join(root, NOTES_DIR),
    // The upgrade already passed the guard; checking again here keeps the
    // sync server safe even if it is mounted somewhere else later.
    authenticate: ({ request }) => {
      if (rejectForeignRequest(request, hosts)) return null;
      // Asked on every open and write, so a writer turned reader writes no more.
      const viewer = viewerOf(request);
      return {
        read: (path) => atLeast(viewer.current(), 'reader') && note(path) !== null,
        write: (path) => !readOnly && atLeast(viewer.current(), 'writer') && writable(path),
      };
    },
  });
  return {
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
      // The gate and the change request lookup ran before: the browser may
      // have gone, or the session ended since.
      const viewer = viewerOf(request);
      if (socket.destroyed || !atLeast(viewer.current(), 'reader')) {
        socket.destroy();
        return;
      }
      socket.once('close', viewer.watch(() => { socket.destroy(); }));
      server.handleUpgrade(request, socket, head);
    },
    close: () => server.close(),
  };
}
