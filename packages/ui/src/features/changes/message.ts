import type { ChangedFile, ChangeStatus } from '#api/changes.ts';
import { classifyPath } from '@fdbook/shared/asset-types.ts';
import { NOTES_PREFIX } from '#lib/note-paths.ts';
import { shortPath } from './labels';

const PREFIX = 'docs(notes): ';
const VERB: Record<ChangeStatus, string> = { M: 'update', A: 'add', D: 'remove', R: 'rename' };

const isPage = (file: ChangedFile) => file.path.startsWith(NOTES_PREFIX) && file.path.endsWith('.mdx');
const isMeta = (file: ChangedFile) => file.path.startsWith(NOTES_PREFIX) && file.path.endsWith('/meta.yaml');
const isDiagram = (file: ChangedFile) => classifyPath(file.path) === 'diagram';

// The folder a file sits in, by name ('notes' at the top of content/notes).
function folderOf(path: string) {
  const segments = shortPath(path).split('/');
  return segments.length > 1 ? segments[segments.length - 2] : 'notes';
}

// A page by its slug; a folder page by its folder.
function slugOf(path: string) {
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.mdx$/, '');
  if (name !== 'index') return name;
  return path === `${NOTES_PREFIX}index.mdx` ? 'notes home' : folderOf(path);
}

const unique = <T>(values: T[]) => [...new Set(values)];

// The commit message the Changes view starts from, for the picked files: what
// happened to the pages, else to the page order (meta.yaml), else to the
// diagrams, else to the assets. A page's own meta.yaml and images go without saying.
export function suggestMessage(files: ChangedFile[]): string {
  const pages = files.filter(isPage);
  if (pages.length === 1) {
    const [page] = pages;
    if (page.status === 'R' && page.from !== undefined) return `${PREFIX}rename ${slugOf(page.from)} to ${slugOf(page.path)}`;
    return `${PREFIX}${VERB[page.status]} ${slugOf(page.path)}`;
  }
  if (pages.length === 2) {
    // The Studio renames a page as a delete and an add.
    const gone = pages.find((page) => page.status === 'D');
    const added = pages.find((page) => page.status === 'A');
    if (gone && added) return `${PREFIX}rename ${slugOf(gone.path)} to ${slugOf(added.path)}`;
  }
  if (pages.length > 1) {
    const statuses = unique(pages.map((page) => page.status));
    const verb = statuses.length === 1 && statuses[0] !== 'R' ? VERB[statuses[0]] : 'update';
    const folders = unique(pages.map((page) => folderOf(page.path)));
    return folders.length === 1 ? `${PREFIX}${verb} ${folders[0]} (${String(pages.length)} pages)` : `${PREFIX}${verb} ${String(pages.length)} pages`;
  }
  const metas = files.filter(isMeta);
  if (metas.length > 0) return `${PREFIX}reorder ${unique(metas.map((meta) => folderOf(meta.path))).join(', ')}`;
  const diagrams = files.filter(isDiagram);
  if (diagrams.length === 1) return `${PREFIX}${VERB[diagrams[0].status]} diagram ${diagrams[0].path.slice(diagrams[0].path.lastIndexOf('/') + 1).replace(/\.diagram\.json$/, '')}`;
  if (diagrams.length > 1) return `${PREFIX}update ${String(diagrams.length)} diagrams`;
  if (files.length > 0) return `${PREFIX}update assets of ${unique(files.map((file) => folderOf(file.path))).join(', ')}`;
  return '';
}
