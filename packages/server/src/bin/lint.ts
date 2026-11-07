import { resolve } from 'node:path';
import { loadProject } from '#infra/config/project.ts';
import { setAreas } from '@fdbook/shared/asset-types.ts';

// Lints every note of a project: `npm run studio:lint -- <folder>` from the
// repo root. Prints one line per issue and exits 1 when any is an error.
const project = await loadProject(resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2] ?? '.'));
setAreas(project.areas);
const { lintWorktree } = await import('#services/lint/context.ts');
const results = await lintWorktree(project.repo);
let errors = 0;
let warnings = 0;
for (const { path, issues } of results) {
  for (const issue of issues) {
    if (issue.severity === 'error') errors += 1;
    else warnings += 1;
    console.log(`${path}:${String(issue.start.line)}:${String(issue.start.column)} ${issue.severity} ${issue.rule} ${issue.message}`);
  }
}
console.log(`${String(results.length)} notes, ${String(errors)} errors, ${String(warnings)} warnings`);
process.exitCode = errors > 0 ? 1 : 0;
