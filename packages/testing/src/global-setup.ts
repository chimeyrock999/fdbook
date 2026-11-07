import { installProblem } from '@fdbook/server/deps.ts';

// Tests on packages other than the lockfiles pin fail in scattered ways (a
// 500 here, an undefined there); stop the run with the reinstall message the
// server prints instead. An exit rather than a throw: vitest reports a global
// setup error as "No test files found" and can lose the message while it
// source-maps the stack.
export default function setup() {
  const problem = installProblem();
  if (problem === null) return;
  console.error(problem);
  process.exit(1);
}
