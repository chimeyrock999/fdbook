import { readFile, realpath } from 'node:fs/promises';
import { RequestError } from '@agentclientprotocol/sdk';
import { writeAtomic } from '../files/store.ts';
import { isTextPath } from '../security/asset-types.ts';
import { resolveWorktreePath } from '../security/paths.ts';
import { worktreePathOf as insideOf } from './worktree.ts';

// What an agent may do through fs/read_text_file and fs/write_text_file. It
// names files by absolute path; the Studio answers only inside the change
// request's worktree.
// - Read: any file there, but nothing under a hidden folder or file (.git,
//   .env) and nothing a symlink takes outside.
// - Write: what the Studio itself may edit (the path policy): notes,
//   meta.yaml, SVG and HTML assets, as text.

const READ_MAX_BYTES = 2 * 1024 * 1024;
const WRITE_MAX_BYTES = 2 * 1024 * 1024;

const refuse = (message: string) => RequestError.invalidParams(undefined, message);

const hidden = (path: string) => path.split('/').some((segment) => segment.startsWith('.'));

export async function readForAgent(root: string, path: string, line?: number | null, limit?: number | null) {
  const realRoot = await realpath(root);
  const lexical = insideOf(root, path) ?? insideOf(realRoot, path);
  if (lexical === null || hidden(lexical)) throw refuse(`the Studio reads only files in this change request: ${path}`);
  // Resolved, it must still be inside: a symlink may not lead out.
  const real = await realpath(path).catch(() => null);
  const resolved = real === null ? null : insideOf(realRoot, real);
  if (resolved === null || hidden(resolved)) throw RequestError.resourceNotFound(path);
  const data = await readFile(real ?? path);
  if (data.length > READ_MAX_BYTES) throw refuse(`${lexical} is larger than ${String(READ_MAX_BYTES)} bytes`);
  const text = data.toString('utf8');
  if (line == null && limit == null) return text;
  // ACP lines count from 1.
  const lines = text.split('\n');
  const start = Math.max(0, (line ?? 1) - 1);
  return lines.slice(start, limit == null ? undefined : start + limit).join('\n');
}

// Writes `content` and answers the worktree path and its size.
// `beforeWrite` is told what the file held (null: missing) just before.
export async function writeForAgent(root: string, path: string, content: string, beforeWrite?: (path: string, previous: Buffer | null) => void) {
  const worktreePath = insideOf(root, path) ?? insideOf(await realpath(root), path);
  if (worktreePath === null || !isTextPath(worktreePath)) {
    throw refuse(`the Studio lets agents write only notes, meta.yaml and SVG or HTML assets in this change request: ${path}`);
  }
  const resolved = resolveWorktreePath(root, worktreePath);
  if (resolved === null) throw refuse(`${worktreePath} goes through a symlink or is not a file`);
  const bytes = Buffer.byteLength(content);
  if (bytes > WRITE_MAX_BYTES) throw refuse(`${worktreePath} would be larger than ${String(WRITE_MAX_BYTES)} bytes`);
  beforeWrite?.(worktreePath, await readFile(resolved.absolute).catch(() => null));
  await writeAtomic(resolved.absolute, content);
  return { path: worktreePath, bytes };
}
