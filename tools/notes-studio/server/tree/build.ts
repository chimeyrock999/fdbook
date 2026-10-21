import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type * as PageTree from 'fumadocs-core/page-tree';
import { loader } from 'fumadocs-core/source';
import { parse } from 'yaml';
import { listEditableFiles } from '../files/store.ts';
import { joinPath } from '../lint/rules/links.ts';
import { NOTES_DIR } from '../security/paths.ts';
import type { Hidden, TreeFolder, TreeNode } from './types.ts';

// The page tree, built by the same fumadocs loader the site uses
// (lib/source.ts), so the Studio shows the sidebar the site will build. On
// top of it: which meta.yaml entry each node comes from, the entries that
// reach nothing, and what the site hides (lib/visible-page-tree.ts).

type Data = Record<string, unknown>;

// Pattern of fumadocs' page tree builder (fumadocs-core/source).
const SEPARATOR = /^---(?:\[([^\]]+)])?(.+)---|^---$/;
const LINK = /^(?:external:)?(?:\[[^\]]+])?\[[^\]]+]\([^)]+\)$/;
const REST = new Set(['...', 'z...a']);

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function parseData(yaml: string): Data {
  try {
    const value: unknown = parse(yaml);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Data) : {};
  } catch {
    return {};
  }
}

// What the tree needs from content/notes: each note's frontmatter and each
// meta.yaml, keyed by path relative to content/notes.
export type NotesContent = { pages: Map<string, Data>; metas: Map<string, Data>; mtimes?: Map<string, number> };

export async function readNotesContent(root: string): Promise<NotesContent> {
  const pages = new Map<string, Data>();
  const metas = new Map<string, Data>();
  const mtimes = new Map<string, number>();
  const files = (await listEditableFiles(root)).filter((file) => file.kind !== 'asset');
  await Promise.all(
    files.map(async (file) => {
      const text = await readFile(join(root, file.path), 'utf8').catch(() => null);
      if (text === null) return;
      const path = file.path.slice(NOTES_DIR.length + 1);
      mtimes.set(path, file.mtimeMs);
      if (file.kind === 'meta') metas.set(path, parseData(text));
      else pages.set(path, parseData(FRONTMATTER.exec(text)?.[1] ?? ''));
    }),
  );
  return { pages, metas, mtimes };
}

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function makeContext({ pages, metas, mtimes = new Map() }: NotesContent) {
  const folders = new Set<string>();
  for (const path of [...pages.keys(), ...metas.keys()]) {
    for (let dir = dirOf(path); dir !== ''; dir = dirOf(dir)) folders.add(dir);
  }
  const pageAt = (path: string) => (pages.has(`${path}.mdx`) ? `${path}.mdx` : path.endsWith('.mdx') && pages.has(path) ? path : null);
  return { pages, metas, mtimes, folders, pageAt };
}

type Context = ReturnType<typeof makeContext>;

// The node an entry of `pages` in the folder `folder` resolves to, as
// fumadocs resolves it (a folder first, then a page), as the node's id;
// false when it reaches neither; null for entries that name no single page
// or folder (separators, links, `...`, and `!x` or `...x` that do reach).
function resolveEntry(context: Context, folder: string, item: string): string | false | null {
  if (REST.has(item) || SEPARATOR.test(item) || LINK.test(item)) return null;
  if (item.startsWith('!')) {
    const path = joinPath(folder, item.slice(1));
    return context.folders.has(path) || context.pageAt(path) ? null : false;
  }
  if (item.startsWith('...')) return context.folders.has(joinPath(folder, item.slice(3))) ? null : false;
  const path = joinPath(folder, item);
  if (context.folders.has(path)) return `folder:${path}`;
  const page = context.pageAt(path);
  return page ? `page:${page}` : false;
}

// Node names are React nodes in fumadocs; the loader makes them strings.
const nameOf = (node: { name?: unknown }) => (typeof node.name === 'string' ? node.name : '');

function hiddenOf(data: Data | undefined): Hidden | null {
  return data?.visible === false ? 'visible-false' : null;
}

function convertNode(context: Context, node: PageTree.Node, folder: string): TreeNode {
  if (node.type === 'separator') return { kind: 'separator', id: '', entry: null, title: nameOf(node) };
  if (node.type === 'page') {
    if (node.$ref === undefined) return { kind: 'link', id: '', entry: null, title: nameOf(node), url: node.url };
    return { kind: 'page', id: `page:${node.$ref}`, entry: null, title: nameOf(node), path: node.$ref, hidden: hiddenOf(context.pages.get(node.$ref)) };
  }
  return convertFolder(context, node, folder);
}

// A folder's path. fumadocs-core before 16.17 gave folders a meta path
// string as `$ref`: every folder would get the same empty path and id.
function folderPath(folder: PageTree.Folder): string {
  const ref: unknown = folder.$ref;
  if (typeof ref === 'object' && ref !== null && typeof (ref as { folder?: unknown }).folder === 'string') return (ref as { folder: string }).folder;
  throw new Error('fumadocs-core is older than the site requires: run `npm install` from the repo root.');
}

function convertFolder(context: Context, node: PageTree.Folder | PageTree.Root, path: string): TreeFolder {
  const ref = '$ref' in node ? node.$ref : undefined;
  const meta = ref?.meta ?? (path === '' && context.metas.has('meta.yaml') ? 'meta.yaml' : null);
  const metaData = meta === null ? undefined : context.metas.get(meta);
  const children = node.children.map((child) => convertNode(context, child, child.type === 'folder' ? folderPath(child) : path));
  const folder: TreeFolder = {
    kind: 'folder',
    id: `folder:${path}`,
    entry: null,
    title: nameOf(node),
    path,
    meta,
    metaMtime: meta === null ? null : (context.mtimes.get(meta) ?? null),
    index: 'index' in node && node.index?.$ref !== undefined ? node.index.$ref : null,
    hidden: hiddenOf(metaData),
    children,
  };
  markEntries(context, folder, metaData);
  return folder;
}

// Gives each child the index of the entry it comes from, adds the entries
// that reach nothing at their place, and ids the nodes without a path.
function markEntries(context: Context, folder: TreeFolder, metaData: Data | undefined) {
  const items = metaData === undefined ? undefined : metaData.pages;
  if (!Array.isArray(items)) {
    // No pages list (or no meta.yaml): every child is listed, in this order.
    folder.children.forEach((child, index) => {
      child.entry = folder.meta === null ? index : null;
    });
  } else {
    const byTarget = new Map<string, number>();
    const extracted = new Map<string, number>();
    const separators: number[] = [];
    const links: number[] = [];
    const missing: TreeNode[] = [];
    let rest: number | null = null;
    items.forEach((item, index) => {
      if (typeof item !== 'string') return;
      if (REST.has(item)) rest ??= index;
      else if (SEPARATOR.test(item)) separators.push(index);
      else if (LINK.test(item)) links.push(index);
      else if (item.startsWith('...')) extracted.set(joinPath(folder.path, item.slice(3)), index);
      const target = resolveEntry(context, folder.path, item);
      if (target === false) missing.push({ kind: 'missing', id: '', entry: index, value: item, meta: folder.meta ?? '' });
      else if (target !== null && !byTarget.has(target)) byTarget.set(target, index);
    });
    // Where each child sits in `pages`: its own entry, or the `...x` or
    // `...` that brought it in. Entries that reach nothing go in by it.
    const origins = folder.children.map((child) => {
      if (child.kind === 'separator') child.entry = separators.shift() ?? null;
      else if (child.kind === 'link') child.entry = links.shift() ?? null;
      else child.entry = byTarget.get(child.id) ?? null;
      if (child.entry !== null) return child.entry;
      const from = child.kind === 'page' || child.kind === 'folder' ? extracted.get(dirOf(child.path)) : undefined;
      return from ?? rest ?? Infinity;
    });
    for (const node of missing) {
      const entry = node.entry ?? 0;
      let at = origins.length;
      while (at > 0 && (origins[at - 1] ?? 0) >= entry) at -= 1;
      folder.children.splice(at, 0, node);
      origins.splice(at, 0, entry);
    }
  }
  folder.children.forEach((child, index) => {
    if (child.id === '') child.id = `${child.kind}:${folder.meta ?? folder.path}:${child.entry === null ? `#${String(index)}` : String(child.entry)}`;
  });
}

function folderMap(folder: TreeFolder, map = new Map<string, TreeFolder>()) {
  map.set(folder.path, folder);
  for (const child of folder.children) if (child.kind === 'folder') folderMap(child, map);
  return map;
}

// Puts what fumadocs left in its fallback tree (no meta.yaml lists it) into
// the tree at its own folder, after the listed children, marked unlisted.
function mergeFallback(context: Context, main: Map<string, TreeFolder>, into: TreeFolder, fallback: PageTree.Folder | PageTree.Root) {
  for (const child of fallback.children) {
    if (child.type === 'folder' && main.has(folderPath(child))) {
      const existing = main.get(folderPath(child));
      if (existing) mergeFallback(context, main, existing, child);
      continue;
    }
    if (child.type === 'separator') continue;
    const node = convertNode(context, child, child.type === 'folder' ? folderPath(child) : into.path);
    if (node.kind === 'page' || node.kind === 'folder') node.hidden = 'unlisted';
    node.entry = null;
    into.children.push(node);
  }
}

export function buildTree(content: NotesContent): TreeFolder {
  const context = makeContext(content);
  const files = [
    ...[...content.pages].map(([path, data]) => ({ type: 'page' as const, path, data })),
    ...[...content.metas].map(([path, data]) => ({ type: 'meta' as const, path, data })),
  ];
  const source = loader({ baseUrl: '/notes', source: { files } });
  const tree = source.getPageTree();
  const root = convertFolder(context, tree, '');
  if (tree.fallback) mergeFallback(context, folderMap(root), root, tree.fallback);
  return root;
}

export async function loadTree(root: string) {
  return buildTree(await readNotesContent(root));
}
