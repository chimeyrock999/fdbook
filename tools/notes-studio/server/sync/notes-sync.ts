import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createSyncServer } from '@fumadocs-editor/core/node';
import { rejectForeignRequest } from '../security/guard.ts';
import { NOTES_DIR, resolveWorktreePath } from '../security/paths.ts';

// The fumadocs-editor sync server over content/notes: live documents that
// merge edits made on disk. Its paths are relative to content/notes; the
// same path check as the file API (policy plus no symlinks) decides what it
// may read and write, so `.md`, hidden files and anything outside the notes
// stay out. Its media endpoints are not mounted: assets go through the file
// API into public/.
export function createNotesSync(root: string, port: number) {
  const note = (path: string) => {
    const resolved = resolveWorktreePath(root, `${NOTES_DIR}/${path}`);
    return resolved?.kind === 'note' ? resolved.absolute : null;
  };
  // Writes only to notes that already exist. Its tree commands would create
  // files the scope never sees (`mkdir` also writes meta.json) and leave
  // meta.yaml alone, so new pages go through the file API (#11).
  const writable = (path: string) => {
    const absolute = note(path);
    return absolute !== null && existsSync(absolute);
  };
  return createSyncServer({
    root: join(root, NOTES_DIR),
    // The upgrade already passed the guard; checking again here keeps the
    // sync server safe even if it is mounted somewhere else later.
    authenticate: ({ request }) =>
      rejectForeignRequest(request, port) ? null : { read: (path) => note(path) !== null, write: writable },
  });
}
