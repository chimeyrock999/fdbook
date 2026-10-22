import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
  return createSyncServer({
    root: join(root, NOTES_DIR),
    // The upgrade already passed the guard; checking again here keeps the
    // sync server safe even if it is mounted somewhere else later.
    authenticate: ({ request }) => {
      if (rejectForeignRequest(request, hosts)) return null;
      // Asked on every read and write: the socket stays open after a sign-out or a role taken away.
      const viewer = viewerOf(request);
      return {
        read: (path) => atLeast(viewer.current(), 'reader') && note(path) !== null,
        write: (path) => !readOnly && atLeast(viewer.current(), 'writer') && writable(path),
      };
    },
  });
}
