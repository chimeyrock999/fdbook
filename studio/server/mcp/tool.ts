import type { z } from 'zod';
import type { Role } from '../auth/shared.ts'; // 'reader' | 'writer' | 'admin'

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string /* base64 */; mimeType: string };
export type ToolResult = { content: ToolContent[]; structured?: Record<string, unknown>; isError?: boolean };

// Who calls: an agent run started by the Studio, or a person's terminal agent.
export type ToolCaller =
  | { kind: 'run'; runId: string; agent: string; role: 'author' | 'reviewer' }
  | { kind: 'person'; login: string | null; role: Role };

export type StudioFiles = {
  // Paths are worktree-relative posix and go through the path policy (resolveWorktreePath); null = missing.
  read(path: string): Promise<{ content: string; mtimeMs: number } | null>;
  readBytes(path: string): Promise<{ data: Buffer; mtimeMs: number } | null>;
  // Under the worktree's notes lock. baseMtime: null = must not exist yet; undefined = no check.
  // A mismatch throws FileConflictError { content, mtimeMs } (the file API's 409). A run's writes go on its Keep/Revert list.
  write(path: string, content: string | Buffer, opts?: { baseMtime?: number | null }): Promise<{ mtimeMs: number }>;
};

export type StudioToolContext = { slug: string; root: string; caller: ToolCaller; files: StudioFiles; signal: AbortSignal };

export type StudioTool<I extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: I;
  // 'write' is refused for a reviewer run and for a reader. 'read' is open to anyone who can read the CR.
  access: 'read' | 'write';
  run(args: z.infer<I>, ctx: StudioToolContext): Promise<ToolResult>;
};
