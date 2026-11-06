import { chmod, readdir, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json, rawRequest } from '../../support/http';
import { startTestStudio, type TestStudio } from '../../support/studio';

type FileBody = { path: string; content: string; mtimeMs: number };
type ConflictBody = { error: string; path: string; content: string | null; mtimeMs: number | null };

describe('file API', () => {
  let studio: TestStudio;

  const put = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    rawRequest(studio.fileUrl(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: studio.origin, ...headers },
      body: JSON.stringify(body),
    });
  const read = async (path: string) => json(await rawRequest(studio.fileUrl(path))) as FileBody;

  beforeAll(async () => {
    studio = await startTestStudio();
  });

  afterAll(async () => {
    await studio.close();
  });

  describe('reads', () => {
    it('returns a note with its mtime', async () => {
      const response = await rawRequest(studio.fileUrl('content/docs/index.mdx'));
      expect(response.status).toBe(200);
      const body = json(response) as FileBody;
      const absolute = join(studio.root, 'content/docs/index.mdx');
      expect(body.content).toBe(await readFile(absolute, 'utf8'));
      expect(body.mtimeMs).toBe((await stat(absolute)).mtimeMs);
    });

    it('returns asset bytes with an X-Mtime header', async () => {
      const response = await rawRequest(studio.fileUrl('public/docs/demo/pixel.png'));
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['x-mtime']).toBeDefined();
      expect([...response.body]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });

    it('answers 404 for an allowed path that does not exist', async () => {
      expect((await rawRequest(studio.fileUrl('content/docs/missing.mdx'))).status).toBe(404);
    });

    it('lists files even when an entry cannot be read, and skips symlinks', async () => {
      await symlink('loop.mdx', join(studio.root, 'content/docs/loop.mdx'));
      const response = await rawRequest(`${studio.url}api/files`);
      expect(response.status).toBe(200);
      const { files } = json(response) as { files: { path: string }[] };
      expect(files.map((file) => file.path)).not.toContain('content/docs/loop.mdx');
      expect(files.length).toBeGreaterThan(80);
      await rm(join(studio.root, 'content/docs/loop.mdx'));
    });

    it('lists every allowed file and nothing else', async () => {
      const response = await rawRequest(`${studio.url}api/files`);
      expect(response.status).toBe(200);
      const { files } = json(response) as { files: { path: string; kind: string; mtimeMs: number }[] };
      const paths = files.map((file) => file.path);
      expect(paths).toContain('content/docs/index.mdx');
      expect(paths).toContain('content/docs/meta.yaml');
      expect(paths).toContain('public/docs/demo/pixel.png');
      expect(paths).not.toContain('package.json');
      expect(paths.every((path) => !path.split('/').some((segment) => segment.startsWith('.')))).toBe(true);
    });
  });

  describe('path policy', () => {
    it.each([
      '../package.json',
      'package.json',
      'content/docs/../../package.json',
      '/etc/passwd',
      'content/other/a.mdx',
      'content/docs/.obsidian/app.json',
      'public/resume/index.html',
    ])('refuses paths outside content/docs and public/docs: %s', async (path) => {
      expect((await rawRequest(studio.fileUrl(path))).status).toBe(403);
      expect((await put(path, { content: 'x', baseMtime: null })).status).toBe(403);
    });

    it.each(['content/docs/a.md', 'content/docs/a.js', 'content/docs/other.yaml', 'public/docs/a.exe'])(
      'refuses unknown extensions: %s',
      async (path) => {
        expect((await put(path, { content: 'x', baseMtime: null })).status).toBe(403);
      },
    );

    it('refuses a request without a path', async () => {
      expect((await rawRequest(`${studio.url}api/file`)).status).toBe(400);
    });
  });

  describe('writes and mtime conflicts', () => {
    it('saves when the base mtime matches', async () => {
      const path = 'content/docs/streaming/index.mdx';
      const before = await read(path);
      const response = await put(path, { content: `${before.content}\nedited\n`, baseMtime: before.mtimeMs });
      expect(response.status).toBe(200);
      const { mtimeMs } = json(response) as { mtimeMs: number };
      expect(mtimeMs).toBe((await stat(join(studio.root, path))).mtimeMs);
      expect(await readFile(join(studio.root, path), 'utf8')).toBe(`${before.content}\nedited\n`);
    });

    it('returns 409 with the disk version when the file changed elsewhere', async () => {
      const path = 'content/docs/database/index.mdx';
      const absolute = join(studio.root, path);
      const opened = await read(path);
      // Obsidian or an agent writes the file while the Studio has it open.
      await writeFile(absolute, `${opened.content}\nfrom obsidian\n`);
      await utimes(absolute, new Date(), new Date(opened.mtimeMs + 5000));

      const response = await put(path, { content: 'studio version', baseMtime: opened.mtimeMs });
      expect(response.status).toBe(409);
      const conflict = json(response) as ConflictBody;
      expect(conflict.content).toBe(`${opened.content}\nfrom obsidian\n`);
      expect(conflict.mtimeMs).toBe((await stat(absolute)).mtimeMs);
      expect(await readFile(absolute, 'utf8')).toBe(`${opened.content}\nfrom obsidian\n`);

      // Choosing "keep mine" retries against the disk mtime.
      expect((await put(path, { content: 'studio version', baseMtime: conflict.mtimeMs })).status).toBe(200);
      expect(await readFile(absolute, 'utf8')).toBe('studio version');
    });

    it('returns 409 when a file deleted elsewhere is saved', async () => {
      const path = 'content/docs/gone.mdx';
      const created = json(await put(path, { content: 'a', baseMtime: null })) as { mtimeMs: number };
      await rm(join(studio.root, path));
      const response = await put(path, { content: 'b', baseMtime: created.mtimeMs });
      expect(response.status).toBe(409);
      expect(json(response)).toMatchObject({ content: null, mtimeMs: null });
    });

    it('keeps the file mode across a save', async () => {
      const path = 'content/docs/data-modeling/index.mdx';
      const absolute = join(studio.root, path);
      await chmod(absolute, 0o600);
      const opened = await read(path);
      const response = await put(path, { content: opened.content, baseMtime: opened.mtimeMs });
      expect(response.status).toBe(200);
      expect((await stat(absolute)).mode & 0o777).toBe(0o600);
      expect((json(response) as { mtimeMs: number }).mtimeMs).toBe((await stat(absolute)).mtimeMs);
    });

    it('creates a new file only when it does not exist', async () => {
      const path = 'content/docs/new-folder/new-page.mdx';
      expect((await put(path, { content: '# New\n', baseMtime: null })).status).toBe(200);
      expect(await readFile(join(studio.root, path), 'utf8')).toBe('# New\n');
      const again = await put(path, { content: 'other', baseMtime: null });
      expect(again.status).toBe(409);
      expect((json(again) as ConflictBody).content).toBe('# New\n');
    });

    it('lets only one of two racing saves from the same base win', async () => {
      const path = 'content/docs/streaming/meta.yaml';
      const opened = await read(path);
      const [first, second] = await Promise.all([
        put(path, { content: `${opened.content}# a\n`, baseMtime: opened.mtimeMs }),
        put(path, { content: `${opened.content}# b\n`, baseMtime: opened.mtimeMs }),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
    });

    it('leaves no temporary files behind', async () => {
      const entries = await readdir(join(studio.root, 'content/docs'), { recursive: true });
      expect(entries.filter((entry) => entry.includes('.studio-'))).toEqual([]);
    });

    it('writes an asset with a base mtime header', async () => {
      const path = 'public/docs/demo/new.png';
      const headers = { Origin: studio.origin, 'Content-Type': 'image/png', 'X-Studio-Write': '1' };
      const created = await rawRequest(studio.fileUrl(path), { method: 'PUT', headers, body: Buffer.from([1, 2, 3]) });
      expect(created.status).toBe(200);
      const { mtimeMs } = json(created) as { mtimeMs: number };
      const conflict = await rawRequest(studio.fileUrl(path), { method: 'PUT', headers, body: Buffer.from([4]) });
      expect(conflict.status).toBe(409);
      const updated = await rawRequest(studio.fileUrl(path), {
        method: 'PUT',
        headers: { ...headers, 'X-Base-Mtime': String(mtimeMs) },
        body: Buffer.from([4]),
      });
      expect(updated.status).toBe(200);
      expect([...(await readFile(join(studio.root, path)))]).toEqual([4]);
    });

    it('rejects a malformed body', async () => {
      expect((await put('content/docs/bad.mdx', { content: 1, baseMtime: null })).status).toBe(400);
      expect((await put('content/docs/bad.mdx', { content: 'x' })).status).toBe(400);
    });
  });

  it('reads and rewrites every real note byte for byte', async () => {
    const entries = (await readdir(join(studio.root, 'content/docs'), { recursive: true })).filter(
      (entry) => entry.endsWith('.mdx') || entry.endsWith('meta.yaml'),
    );
    expect(entries.length).toBeGreaterThan(80);
    for (const entry of entries) {
      const path = `content/docs/${entry.split('\\').join('/')}`;
      const before = await readFile(join(studio.root, path), 'utf8');
      const file = await read(path);
      expect(file.content).toBe(before);
      expect((await put(path, { content: file.content, baseMtime: file.mtimeMs })).status).toBe(200);
      expect(await readFile(join(studio.root, path), 'utf8')).toBe(before);
    }
  });
});
