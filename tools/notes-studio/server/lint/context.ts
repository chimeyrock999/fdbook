import { readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateDiagram } from '../../../../lib/diagram/validate.ts';
import { diagramFilePath } from '../../../../lib/read-diagram.ts';
import { listEditableFiles } from '../files/store.ts';
import { NOTES_DIR } from '../security/paths.ts';
import { lintNote } from './lint.ts';
import type { DiagramProblem, LintContext, LintIssue } from './types.ts';

// The notes in the worktree, relative to content/notes.
async function listPages(root: string) {
  const files = await listEditableFiles(root);
  return new Set(files.filter((file) => file.kind === 'note').map((file) => file.path.slice(NOTES_DIR.length + 1)));
}

const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

// A diagram checked as components/mdx/diagram.tsx checks it: a file that
// cannot be laid out shows a placeholder (an error), a layout problem still
// draws (a warning).
function diagramProblem(root: string, src: string): DiagramProblem | null {
  const file = diagramFilePath(root, src);
  if (!file || !isFile(file)) return 'missing';
  let content: unknown;
  try {
    content = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { severity: 'error', message: 'is not valid JSON' };
  }
  const { scene, issues } = validateDiagram(content);
  const first = issues.find((issue) => issue.severity === 'error') ?? issues.at(0);
  if (!first) return null;
  return { severity: scene ? 'warning' : 'error', message: `[${first.code}] ${first.message}` };
}

// What the rules need from the worktree at `root`, for the note at `path`
// (relative to content/notes). Assets are looked up in the whole of public/,
// and diagrams in diagrams/, as the site reads them at build time.
function contextFor(root: string, pages: ReadonlySet<string>, path: string): LintContext {
  return {
    path,
    pages,
    assetExists: (asset) => isFile(join(root, 'public', asset)),
    diagramProblem: (src) => diagramProblem(root, src),
  };
}

export async function loadLintContext(root: string, path: string) {
  return contextFor(root, await listPages(root), path);
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
