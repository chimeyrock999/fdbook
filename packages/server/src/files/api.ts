import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, pathnameOf, readBody, sendJson, type Handler } from '#http.ts';
import { MAX_ASSET_BYTES } from '@fdbook/shared/asset-types.ts';
import { ASSET_TYPES, extensionOf, resolveWorktreePath, type PathKind } from '#security/paths.ts';
import { createKeyedLock, listEditableFiles, statOrNull } from './store.ts';
import { createStudioFiles, FileConflictError } from './studio-files.ts';

const MAX_TEXT_BYTES = 5 * 1024 * 1024;

type Write = { data: string | Buffer; baseMtime: number | null };

// A text write is JSON and an asset write carries X-Studio-Write: either way a
// browser has to preflight it, so a foreign page cannot send one blind.
async function parseWrite(request: IncomingMessage, kind: PathKind): Promise<Write> {
  if (kind === 'asset') {
    if (request.headers['x-studio-write'] !== '1') throw new HttpError(415, 'asset writes need X-Studio-Write: 1');
    const header = request.headers['x-base-mtime'];
    const baseMtime = typeof header === 'string' && header !== '' ? Number(header) : null;
    if (baseMtime !== null && !Number.isFinite(baseMtime)) throw new HttpError(400, 'X-Base-Mtime must be a number');
    return { data: await readBody(request, MAX_ASSET_BYTES), baseMtime };
  }
  if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'text writes must be application/json');
  }
  let body: unknown;
  try {
    body = JSON.parse((await readBody(request, MAX_TEXT_BYTES)).toString('utf8'));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'body is not JSON');
  }
  const { content, baseMtime } = (body ?? {}) as { content?: unknown; baseMtime?: unknown };
  if (typeof content !== 'string' || !(baseMtime === null || typeof baseMtime === 'number')) {
    throw new HttpError(400, 'body must be { content: string, baseMtime: number | null }');
  }
  return { data: content, baseMtime };
}

// GET /api/files, GET /api/file?path=…, PUT /api/file?path=… on the worktree
// at `root`. A save names the mtime it was edited from (`null` for a new
// file); if the disk moved on since, it answers 409 with what the disk holds
// and writes nothing.
// `beforeSave` is told each path just before a save replaces it.
export function createFilesApi(root: string, pathLock = createKeyedLock(), beforeSave?: (path: string) => void): Handler {
  // Saves to one path run one at a time (studio-files.ts), so two saves from
  // the same base cannot both pass the mtime check.
  const files = createStudioFiles(root, { pathLock, beforeSave });

  async function read(response: ServerResponse, path: string, kind: PathKind, absolute: string) {
    const info = await statOrNull(absolute);
    if (!info?.isFile()) throw new HttpError(404, `no such file: ${path}`);
    const data = await readFile(absolute);
    if (kind !== 'asset') {
      sendJson(response, 200, { path, content: data.toString('utf8'), mtimeMs: info.mtimeMs });
      return;
    }
    response.writeHead(200, {
      'Content-Type': ASSET_TYPES[extensionOf(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Mtime': String(info.mtimeMs),
      // Asset HTML is content, not part of the Studio: never run it here.
      'Content-Security-Policy': 'sandbox',
    });
    response.end(data);
  }

  async function write(request: IncomingMessage, response: ServerResponse, path: string, kind: PathKind) {
    const { data, baseMtime } = await parseWrite(request, kind);
    try {
      sendJson(response, 200, { path, ...(await files.write(path, data, { baseMtime })) });
    } catch (error) {
      if (!(error instanceof FileConflictError)) throw error;
      sendJson(response, 409, { error: 'the file changed on disk', path, content: error.content, mtimeMs: error.mtimeMs });
    }
  }

  async function route(request: IncomingMessage, response: ServerResponse, url: URL) {
    if (url.pathname === '/api/files') {
      if (request.method !== 'GET') throw new HttpError(405, 'method not allowed');
      sendJson(response, 200, { files: await listEditableFiles(root) });
      return;
    }
    const path = url.searchParams.get('path');
    if (!path) throw new HttpError(400, 'missing ?path=');
    const resolved = resolveWorktreePath(root, path);
    if (!resolved) throw new HttpError(403, `not an editable path: ${path}`);
    if (request.method === 'GET') return read(response, path, resolved.kind, resolved.absolute);
    if (request.method === 'PUT') return write(request, response, path, resolved.kind);
    response.setHeader('Allow', 'GET, PUT');
    throw new HttpError(405, 'method not allowed');
  }

  return async (request, response) => {
    const pathname = pathnameOf(request);
    if (pathname !== '/api/files' && pathname !== '/api/file') return false;
    try {
      await route(request, response, new URL(request.url ?? '/', 'http://studio'));
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
    }
    return true;
  };
}
