import type { ChangedFile } from '../api/changes';
import type { TreeFolder } from '../api/tree';
import { NOTES_PREFIX } from '../notes/notes';
import { noteOf } from '../tree/tree';

const META = 'meta.yaml';

// Titles from the page tree, by worktree path: each note's, and each
// folder's under its meta.yaml path.
export function titlesOf(root: TreeFolder | null): Map<string, string> {
  const titles = new Map<string, string>();
  const walk = (folder: TreeFolder) => {
    if (folder.meta !== null) titles.set(NOTES_PREFIX + folder.meta, folder.title);
    for (const node of folder.children) {
      const note = noteOf(node);
      if (note !== null && (node.kind === 'page' || node.kind === 'folder')) titles.set(NOTES_PREFIX + note, node.title);
      if (node.kind === 'folder') walk(node);
    }
  };
  if (root) walk(root);
  return titles;
}

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

// What a changed file is called in the Changes view: a note by its title, a
// meta.yaml as its folder's page order, an asset (or a note the tree no
// longer has) by its file name.
export function labelOf(file: ChangedFile, titles: Map<string, string>) {
  const title = titles.get(file.path);
  if (file.path.endsWith(`/${META}`)) {
    const dir = file.path.slice(0, -META.length - 1);
    return `Page order of ${title ?? nameOf(dir)}`;
  }
  return title ?? nameOf(file.path).replace(/\.mdx$/, '');
}

// The path under content/notes or public/notes, which the area makes plain.
export const shortPath = (path: string) => path.replace(/^(content|public)\/notes\//, '');

// "just now", "5 min ago", "3 hours ago", then the date.
export function timeAgo(date: string, now = Date.now()) {
  const seconds = Math.round((now - Date.parse(date)) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))} min ago`;
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3600);
    return `${String(hours)} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  return new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
