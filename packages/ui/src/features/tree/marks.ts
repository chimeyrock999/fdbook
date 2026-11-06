import type { ChangedFile, ChangeStatus } from '#api/changes.ts';
import type { TreeFolder, TreeMissing } from '#api/tree.ts';
import { NOTES_PREFIX } from '#lib/note-paths.ts';

export const CHANGE_NAME: Record<ChangeStatus, string> = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed' };

// What the page tree marks, by path relative to content/notes: each changed
// note's status (a renamed note's old path counts as deleted), every folder
// that holds a change, and the folders whose meta.yaml changed.
export type TreeMarks = { notes: Map<string, ChangeStatus>; folders: Set<string>; metas: Set<string> };

const inNotes = (path: string) => (path.startsWith(NOTES_PREFIX) ? path.slice(NOTES_PREFIX.length) : null);
const dirOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

export function treeMarks(files: ChangedFile[]): TreeMarks {
  const marks: TreeMarks = { notes: new Map(), folders: new Set(), metas: new Set() };
  const mark = (worktreePath: string, status: ChangeStatus) => {
    const path = inNotes(worktreePath);
    if (path === null) return;
    if (path.endsWith('.mdx')) marks.notes.set(path, status);
    else marks.metas.add(dirOf(path));
    for (let dir = dirOf(path); dir !== ''; dir = dirOf(dir)) marks.folders.add(dir);
  };
  for (const file of files) {
    if (file.from !== undefined) mark(file.from, 'D');
    mark(file.path, file.status);
  }
  return marks;
}

// A folder gets a dot when it is closed over a change, or when its own
// meta.yaml changed: that file has no row of its own.
export const folderMarked = (marks: TreeMarks, folder: TreeFolder, open: boolean) =>
  marks.metas.has(folder.path) || (!open && marks.folders.has(folder.path));

// A meta.yaml entry that reaches nothing because its page was deleted.
export function missingStatus(marks: TreeMarks, node: TreeMissing): ChangeStatus | null {
  const dir = dirOf(node.meta);
  const base = dir === '' ? node.value : `${dir}/${node.value}`;
  const deleted = [`${base}.mdx`, `${base}/index.mdx`].some((path) => marks.notes.get(path) === 'D');
  return deleted ? 'D' : null;
}
