export const NOTES_PREFIX = 'content/notes/';

// The file API speaks worktree paths, the sync socket paths inside content/notes.
export const syncPath = (path: string) => path.slice(NOTES_PREFIX.length);

const isNote = (path: string) => path.startsWith(NOTES_PREFIX) && path.endsWith('.mdx');

// The note to open from `?path=`, if it names a note.
export function noteFromUrl(search: string): string | null {
  const path = new URLSearchParams(search).get('path');
  return path !== null && isNote(path) ? path : null;
}
