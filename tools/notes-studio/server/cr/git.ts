import { execFile } from 'node:child_process';

export class CommandError extends Error {
  readonly code: number | null;
  constructor(command: string, code: number | null, stderr: string) {
    super(stderr.trim() || `${command} failed`);
    this.name = 'CommandError';
    this.code = code;
  }
}

// Runs a command without a shell and resolves its stdout. Git and gh never
// prompt: a command that needs a password fails instead of hanging the server.
export function run(command: string, args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' } },
      (error, stdout, stderr) => {
        if (error) reject(new CommandError(`${command} ${args[0] ?? ''}`, typeof error.code === 'number' ? error.code : null, stderr || error.message));
        else resolve(stdout);
      },
    );
  });
}

export const git = (cwd: string, ...args: string[]) => run('git', args, cwd);

// Lines of output, without the empty last one.
export const lines = (output: string) => output.split('\n').filter((line) => line !== '');
