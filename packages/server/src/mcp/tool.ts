import type { z } from 'zod';
import type { Role } from '@fdbook/shared/auth.ts'; // 'reader' | 'writer' | 'admin'
import type { StudioFiles } from '#files/studio-files.ts';

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string /* base64 */; mimeType: string };
export type ToolResult = { content: ToolContent[]; structured?: Record<string, unknown>; isError?: boolean };

// Who calls: an agent run started by the Studio, or a person's terminal agent.
export type ToolCaller =
  | { kind: 'run'; runId: string; agent: string; role: 'author' | 'reviewer' }
  | { kind: 'person'; login: string | null; role: Role };

export type StudioToolContext = { slug: string; root: string; caller: ToolCaller; files: StudioFiles; signal: AbortSignal };

export type StudioTool<I extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: I;
  // 'write' is refused for a reviewer run and for a reader. 'read' is open to anyone who can read the CR.
  access: 'read' | 'write';
  run(args: z.infer<I>, ctx: StudioToolContext): Promise<ToolResult>;
};
