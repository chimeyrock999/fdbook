import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listEditableFiles } from '../files/store.ts';
import { NOTES_DIR } from '../security/paths.ts';
import { lintNote } from './lint.ts';
import type { LintContext, LintIssue } from './types.ts';

// The notes in the worktree, relative to content/notes.
async function listPages(root: string) {
  const files = await listEditableFiles(root);
  return new Set(files.filter((file) => file.kind === 'note').map((file) => file.path.slice(NOTES_DIR.length + 1)));
}

// What the rules need from the worktree at `root`, for the note at `path`
// (relative to content/notes). Assets are looked up in the whole of public/,
// as the site reads them at build time.
function contextFor(root: string, pages: ReadonlySet<string>, path: string): LintContext {
  return {
    path,
    pages,
    assetExists: (asset) => {
      try {
        return statSync(join(root, 'public', asset)).isFile();
      } catch {
        return false;
      }
    },
  };
}

export async function loadLintContext(root: string, path: string) {
  return contextFor(root, await listPages(root), path);
}

// The context of any note in the worktree, from one listing of its pages.
export async function loadLintContexts(root: string) {
  const pages = await listPages(root);
  return (path: string) => contextFor(root, pages, path);
}

export type NoteIssues = { path: string; issues: LintIssue[] };

// Every note in the worktree, linted; paths are worktree-relative.
export async function lintWorktree(root: string): Promise<NoteIssues[]> {
  const pages = await listPages(root);
  const results: NoteIssues[] = [];
  for (const page of [...pages].sort()) {
    const source = await readFile(join(root, NOTES_DIR, page), 'utf8');
    results.push({ path: `${NOTES_DIR}/${page}`, issues: lintNote(source, contextFor(root, pages, page)) });
  }
  return results;
}
