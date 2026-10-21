import type { createFilesClient, FileEvent } from '../api/files';
import { readFrontmatter } from '../frontmatter/frontmatter';

export const NOTES_PREFIX = 'content/notes/';

export type NoteItem = { path: string; title: string };

// The file API speaks worktree paths, the sync socket paths inside content/notes.
export const syncPath = (path: string) => path.slice(NOTES_PREFIX.length);

// The note to open from `?path=`, if it names a note.
export function noteFromUrl(search: string): string | null {
  const path = new URLSearchParams(search).get('path');
  return path !== null && isNote(path) ? path : null;
}

type FilesClient = ReturnType<typeof createFilesClient>;

const isNote = (path: string) => path.startsWith(NOTES_PREFIX) && path.endsWith('.mdx');

// The note's frontmatter title, read the way the form reads it; the file
// name when it has none.
async function loadNote(files: FilesClient, path: string): Promise<NoteItem> {
  const title = await files.readFile(path).then(
    (file) => {
      const read = readFrontmatter(file.content);
      return read.status === 'ok' && typeof read.data.title === 'string' && read.data.title !== '' ? read.data.title : null;
    },
    () => null,
  );
  return { path, title: title ?? fallbackTitle(path) };
}

const byPath = (a: NoteItem, b: NoteItem) => a.path.localeCompare(b.path);

// Every note with its title, in path order. Reading each note is fine for a
// local tree of a few hundred files; the page tree (#11) replaces this list.
export async function loadNotes(files: FilesClient): Promise<NoteItem[]> {
  const entries = (await files.listFiles()).filter((entry) => entry.kind === 'note');
  return (await Promise.all(entries.map(({ path }) => loadNote(files, path)))).sort(byPath);
}

// Keeps the list in step with the disk: new, changed (a new title) and
// removed notes, including the Studio's own saves.
export async function applyFileEvent(files: FilesClient, notes: NoteItem[], event: FileEvent): Promise<NoteItem[]> {
  if (!isNote(event.path)) return notes;
  const rest = notes.filter((note) => note.path !== event.path);
  if (event.type === 'unlink') return rest;
  return [...rest, await loadNote(files, event.path)].sort(byPath);
}

function fallbackTitle(path: string) {
  const parts = syncPath(path).replace(/\.mdx$/, '').split('/');
  const last = parts.at(-1) === 'index' ? parts.at(-2) : parts.at(-1);
  return last ?? path;
}

export function filterNotes(notes: NoteItem[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return notes;
  return notes.filter((note) => note.title.toLowerCase().includes(q) || syncPath(note.path).toLowerCase().includes(q));
}
