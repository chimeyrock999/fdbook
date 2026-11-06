import { runGit } from '#services/git/git.ts';
import { HttpError, pathnameOf, readBody, sendJson, type Handler } from '#infra/http.ts';
import type { Attachments } from '#services/agents/context/attachments.ts';
import { mentionKindOf } from '#services/agents/context/context.ts';
import { ATTACHMENT_MAX_BYTES, type Mention, type MentionKind } from '@fdbook/shared/agents.ts';

const MENTIONS_MAX = 50;
// How long a listing of the worktree's files is used again: one per
// keystroke would start git on each.
const LISTING_MS = 5000;
const ORDER: MentionKind[] = ['note', 'asset', 'file'];

// The worktree's files, as git sees them: tracked and new ones, less those
// deleted and those git ignores.
async function filesOf(root: string) {
  const [listed, deleted] = await Promise.all([
    runGit(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
    runGit(root, ['ls-files', '-z', '--deleted']),
  ]);
  const gone = new Set(deleted.split('\0'));
  return [...new Set(listed.split('\0'))].filter((path) => path !== '' && !gone.has(path));
}

// The files whose path holds `query` (case aside), best first: a name that
// starts with it, then a name that holds it, then the rest of the path;
// notes before assets before other files; shorter paths first.
export function rankMentions(paths: string[], query: string, max = MENTIONS_MAX): Mention[] {
  const wanted = query.trim().toLowerCase();
  const scored = paths.flatMap((path) => {
    const lower = path.toLowerCase();
    if (!lower.includes(wanted)) return [];
    const name = lower.slice(lower.lastIndexOf('/') + 1);
    const score = name.startsWith(wanted) ? 0 : name.includes(wanted) ? 1 : 2;
    return [{ path, kind: mentionKindOf(path), score }];
  });
  scored.sort((a, b) => a.score - b.score || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return scored.slice(0, max).map(({ kind, path }) => ({ kind, path }));
}

// What a message can carry, for one change request's worktree:
// GET  /api/agents/mentions?q=…   notes, assets and other files to mention
// POST /api/agents/attachments    a document (the body; its name in X-File-Name, URI-encoded)
// Null `attachments`: agents may not work here (a Studio without change requests).
export function createAgentContextApi(root: string, slug: string, attachments: Attachments | null): Handler {
  let listing: { at: number; files: Promise<string[]> } | null = null;
  const files = () => {
    if (listing === null || Date.now() - listing.at > LISTING_MS) {
      const next = { at: Date.now(), files: filesOf(root) };
      next.files.catch(() => { if (listing === next) listing = null; });
      listing = next;
    }
    return listing.files;
  };

  async function answer(pathname: string, request: Parameters<Handler>[0]): Promise<unknown> {
    if (attachments === null) throw new HttpError(409, 'Agents work in a change request: open one first.');
    if (pathname === '/api/agents/mentions') {
      if (request.method !== 'GET') throw new HttpError(405, 'method not allowed');
      const query = new URL(request.url ?? '/', 'http://studio').searchParams.get('q') ?? '';
      return { mentions: rankMentions(await files(), query) };
    }
    if (request.method !== 'POST') throw new HttpError(405, 'method not allowed');
    const header = request.headers['x-file-name'];
    let name: string;
    try {
      name = decodeURIComponent(typeof header === 'string' ? header : '');
    } catch {
      throw new HttpError(400, 'X-File-Name must be URI-encoded');
    }
    return { attachment: await attachments.save(slug, name, await readBody(request, ATTACHMENT_MAX_BYTES)) };
  }

  return async (request, response) => {
    const pathname = pathnameOf(request);
    if (pathname !== '/api/agents/mentions' && pathname !== '/api/agents/attachments') return false;
    try {
      sendJson(response, 200, await answer(pathname, request));
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
