import { readFile } from 'node:fs/promises';
import { HttpError, pathnameOf, readJsonObject, sendJson, type Handler } from '#infra/http.ts';
import { viewerOf } from '#services/auth/access.ts';
import { classifyPath, NOTES_DIR, resolveWorktreePath } from '#infra/security/paths.ts';
import type { Anchor } from '@fdbook/shared/anchors.ts';
import { THREAD_SEVERITIES, THREAD_STATES, type ThreadAuthor, type ThreadSeverity, type ThreadState } from '@fdbook/shared/review.ts';
import type { Threads } from '#services/review/threads.ts';

// An anchor holds whole blocks: a long code block too.
const MAX_BODY_BYTES = 1024 * 1024;
const NO_CR = 'Review threads live in a change request: open one first.';
const ONE = /^\/api\/threads\/([a-z0-9-]+)(?:\/(comments|state))?$/;

const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;

// The anchor the editor made (anchorAt on the text it shows, which may hold
// edits not saved yet), checked for shape.
function anchorOf(value: unknown): Anchor | null {
  if (value === null || value === undefined) return null;
  const { index, text, before, after, seen } = value as Record<string, unknown>;
  const block = (each: unknown) => each === null || isText(each, MAX_BODY_BYTES);
  if (!(Number.isInteger(index) && (index as number) >= 0 && isText(text, MAX_BODY_BYTES) && block(before) && block(after) && Array.isArray(seen) && seen.length <= 20_000 && seen.every((hash) => isText(hash, 16)))) {
    throw new HttpError(400, 'anchor must be { index, text, before, after, seen } of the block (anchorAt)');
  }
  return { index, text, before, after, seen } as Anchor;
}

const severityOf = (value: unknown): ThreadSeverity | null => {
  if (value === null || value === undefined) return null;
  if (!THREAD_SEVERITIES.includes(value as ThreadSeverity)) throw new HttpError(400, `severity must be ${THREAD_SEVERITIES.join(' or ')}`);
  return value as ThreadSeverity;
};

const bodyOf = (value: unknown) => {
  if (value !== undefined && typeof value !== 'string') throw new HttpError(400, 'body must be text');
  return value ?? '';
};

// A person's review threads of one change request
// (services/review/threads.ts), or null where there are none (main). Agents
// use the MCP tools (routes/mcp/review-tools.ts).
// GET  /api/threads[?path=…]           every thread (of one note), oldest first
// POST /api/threads { path, anchor, body, severity?, rule? }  opens one; anchor null: on the whole note
// GET  /api/threads/<id>
// POST /api/threads/<id>/comments { body }       a reply
// POST /api/threads/<id>/state { state, body? }  a move (shared.ts); rejected needs a body
// Each change goes out as a `thread` event on /api/proposals/events.
export function createThreadsApi(root: string, threads: Threads | null): Handler {
  async function answer(pathname: string, request: Parameters<Handler>[0]): Promise<unknown> {
    if (threads === null) throw new HttpError(409, NO_CR);
    const by: ThreadAuthor = { kind: 'person', login: viewerOf(request).user?.login ?? null };
    if (pathname === '/api/threads') {
      if (request.method === 'GET') return { threads: await threads.list(new URL(request.url ?? '/', 'http://studio').searchParams.get('path') ?? undefined) };
      if (request.method !== 'POST') throw new HttpError(405, 'method not allowed');
      const { path, anchor, body, severity, rule } = await readJsonObject(request, MAX_BODY_BYTES, 'a thread');
      if (typeof path !== 'string' || classifyPath(path) !== 'note') throw new HttpError(400, `path must be a note: ${NOTES_DIR}/….mdx`);
      const resolved = resolveWorktreePath(root, path);
      if (resolved === null || (await readFile(resolved.absolute).then(() => false, () => true))) throw new HttpError(404, `no such note: ${path}`);
      if (rule !== undefined && rule !== null && typeof rule !== 'string') throw new HttpError(400, 'rule must be text');
      return { thread: await threads.open({ path, anchor: anchorOf(anchor), body: bodyOf(body), by, severity: severityOf(severity), rule: rule ?? null }) };
    }
    const match = ONE.exec(pathname);
    const id = match?.[1] ?? '';
    const part: string | undefined = match?.[2];
    if (part === undefined) {
      if (request.method !== 'GET') throw new HttpError(405, 'method not allowed');
      return { thread: await threads.read(id) };
    }
    if (request.method !== 'POST') throw new HttpError(405, 'method not allowed');
    const given = await readJsonObject(request, MAX_BODY_BYTES, part === 'state' ? 'a move' : 'a reply');
    if (part === 'comments') return { thread: await threads.reply(id, { body: bodyOf(given.body), by }) };
    if (!THREAD_STATES.includes(given.state as ThreadState)) throw new HttpError(400, `state must be one of ${THREAD_STATES.join(', ')}`);
    return { thread: await threads.move(id, { state: given.state as ThreadState, body: bodyOf(given.body), by }) };
  }

  return async (request, response) => {
    const pathname = pathnameOf(request);
    if (pathname !== '/api/threads' && !ONE.test(pathname)) return false;
    try {
      sendJson(response, 200, await answer(pathname, request));
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
