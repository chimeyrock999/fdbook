import { repoRoot } from '../config.ts';
import { lintWorktree } from './context.ts';

// Lints every note in this checkout: `npm run studio:lint` from the repo root.
// Prints one line per issue and exits 1 when any is an error.
const results = await lintWorktree(repoRoot);
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
