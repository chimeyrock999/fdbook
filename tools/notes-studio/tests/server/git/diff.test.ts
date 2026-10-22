import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { git } from '../../support/git';
import { json, rawRequest } from '../../support/http';
import { startTestStudio, type TestStudio } from '../../support/studio';

type Side = { kind: 'text'; text: string; size: number } | { kind: 'binary'; size: number };
type Diff = { path: string; from?: string; base: string | null; status: string; before: Side | null; after: Side | null };

const NOTE = 'content/notes/streaming/index.mdx';
const PIXEL = 'public/notes/demo/pixel.png';

// The diff API on a git worktree copy of content/notes, through the real
// server: a change request's files against where it left main. The tests
// run in order and build on each other's commits.
describe('diff API', () => {
  let studio: TestStudio;
  let original: string;
  let forked: string;

  const diff = async (path: string, from?: string) => {
    const query = new URLSearchParams({ path, ...(from === undefined ? {} : { from }) });
    return rawRequest(`${studio.url}api/changes/diff?${query.toString()}`);
  };
  const diffOf = async (path: string, from?: string) => {
    const response = await diff(path, from);
    expect(response.status).toBe(200);
    return json(response) as Diff;
  };
  const blob = (path: string, base?: string) => rawRequest(`${studio.url}api/changes/blob?${new URLSearchParams({ path, ...(base === undefined ? {} : { base }) }).toString()}`);
  const at = (path: string) => join(studio.root, path);

  beforeAll(async () => {
    studio = await startTestStudio({ git: true });
    original = await readFile(at(NOTE), 'utf8');
    forked = git(studio.root, 'rev-parse', 'HEAD').trim();
  });
  afterAll(async () => {
    await studio.close();
  });

  it('shows an unchanged note the same on both sides', async () => {
    expect(await diffOf(NOTE)).toEqual({
      path: NOTE,
      base: forked,
      status: 'same',
      before: { kind: 'text', text: original, size: Buffer.byteLength(original) },
      after: { kind: 'text', text: original, size: Buffer.byteLength(original) },
    });
  });

  it('compares the committed and the uncommitted edits with main', async () => {
    await writeFile(at(NOTE), `${original}\nCommitted line.\n`);
    git(studio.root, 'commit', '--quiet', '-am', 'docs: committed edit');
    await writeFile(at(NOTE), `${original}\nCommitted line.\n\nNot committed yet.\n`);
    const answer = await diffOf(NOTE);
    expect(answer.status).toBe('M');
    expect(answer.base).toBe(forked);
    expect(answer.before).toMatchObject({ kind: 'text', text: original });
    expect(answer.after).toMatchObject({ kind: 'text', text: `${original}\nCommitted line.\n\nNot committed yet.\n` });
  });

  it('keeps comparing with where the change request left main after main moves on', async () => {
    // main moves in a worktree of its own, as another change request merging would.
    const other = `${studio.root}-main`;
    git(studio.root, 'worktree', 'add', '--quiet', other, 'main');
    await writeFile(join(other, 'content/notes/streaming/meta.yaml'), 'title: Moved on\n');
    git(other, 'commit', '--quiet', '-am', 'main moved');
    git(studio.root, 'update-ref', 'refs/remotes/origin/main', 'main');
    git(studio.root, 'worktree', 'remove', '--force', other);
    const meta = await diffOf('content/notes/streaming/meta.yaml');
    expect(meta.base).toBe(forked);
    // main's own change is not this change request's work.
    expect(meta.status).toBe('same');
  });

  it('shows a new file with nothing before it, and a deleted one with nothing after it', async () => {
    await writeFile(at('content/notes/streaming/new-page.mdx'), '# New page\n');
    expect(await diffOf('content/notes/streaming/new-page.mdx')).toMatchObject({ status: 'A', before: null, after: { kind: 'text', text: '# New page\n' } });
    await rm(at('content/notes/streaming/watermark-and-late-events.mdx'));
    expect(await diffOf('content/notes/streaming/watermark-and-late-events.mdx')).toMatchObject({ status: 'D', before: { kind: 'text' }, after: null });
  });

  it('reads a renamed file under its old name on main', async () => {
    const page = 'content/notes/streaming/index.mdx';
    const moved = 'content/notes/streaming/overview.mdx';
    git(studio.root, 'mv', page, moved);
    const answer = await diffOf(moved, page);
    expect(answer).toMatchObject({ path: moved, from: page, status: 'R', before: { kind: 'text', text: original } });
    git(studio.root, 'mv', moved, page);
  });

  it('finds a rename already committed, and reads main under the old name', async () => {
    const page = 'content/notes/streaming/index.mdx';
    const moved = 'content/notes/streaming/moved.mdx';
    const edited = await readFile(at(page), 'utf8');
    git(studio.root, 'mv', page, moved);
    git(studio.root, 'commit', '--quiet', '-am', 'docs: move the page');
    await writeFile(at(moved), `${edited}\nAfter the move.\n`);
    // git status compares with HEAD, so the Changes view names no old path.
    expect(await diffOf(moved)).toMatchObject({ path: moved, from: page, status: 'R', before: { kind: 'text', text: original }, after: { kind: 'text', text: `${edited}\nAfter the move.\n` } });
    await writeFile(at(moved), edited);
    git(studio.root, 'mv', moved, page);
    git(studio.root, 'commit', '--quiet', '-am', 'docs: move it back');
  });

  it('answers an image as binary, and serves it as it is on main', async () => {
    const before = await readFile(at(PIXEL));
    await writeFile(at(PIXEL), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
    expect(await diffOf(PIXEL)).toMatchObject({ status: 'M', before: { kind: 'binary', size: 4 }, after: { kind: 'binary', size: 6 } });
    const served = await blob(PIXEL);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['content-security-policy']).toBe('sandbox');
    expect(served.body.equals(before)).toBe(true);
  });

  it('compares a binary file by its content, and serves it at the base the diff named', async () => {
    const pdf = 'public/notes/demo/big.pdf';
    // Larger than git's output cap for other commands: assets go up to 25 MB.
    const big = Buffer.alloc(17 * 1024 * 1024, 1);
    await writeFile(at(pdf), big);
    git(studio.root, 'add', pdf);
    git(studio.root, 'commit', '--quiet', '-m', 'big pdf');
    git(studio.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    const base = git(studio.root, 'rev-parse', 'HEAD').trim();
    expect(await diffOf(pdf)).toMatchObject({ base, status: 'same', before: { kind: 'binary', size: big.length }, after: { kind: 'binary', size: big.length } });
    // Same size, other bytes.
    await writeFile(at(pdf), Buffer.alloc(big.length, 2));
    expect((await diffOf(pdf)).status).toBe('M');
    expect((await blob(pdf, base)).body.equals(big)).toBe(true);
    // The base the diff named, even once main moved past it.
    expect((await blob(PIXEL, forked)).status).toBe(200);
    expect((await blob(PIXEL, 'not-a-sha')).status).toBe(200);
    expect((await blob(PIXEL, 'f'.repeat(40))).status).toBe(404);
  });

  it('answers an SVG as text', async () => {
    await mkdir(at('public/notes/demo'), { recursive: true });
    await writeFile(at('public/notes/demo/shape.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
    expect(await diffOf('public/notes/demo/shape.svg')).toMatchObject({ status: 'A', after: { kind: 'text', text: '<svg xmlns="http://www.w3.org/2000/svg"/>\n' } });
    // Not on main: there is nothing to serve.
    expect((await blob('public/notes/demo/shape.svg')).status).toBe(404);
  });

  it('refuses a path outside the notes, a missing path and a linked file', async () => {
    expect((await diff('package.json')).status).toBe(403);
    expect((await diff('content/notes/../package.json')).status).toBe(403);
    expect((await diff(NOTE, 'package.json')).status).toBe(403);
    expect((await blob('package.json')).status).toBe(403);
    expect((await rawRequest(`${studio.url}api/changes/diff`)).status).toBe(400);
    await symlink(at(NOTE), at('content/notes/streaming/linked.mdx'));
    expect((await diff('content/notes/streaming/linked.mdx')).status).toBe(403);
    expect((await rawRequest(`${studio.url}api/changes/diff?path=${encodeURIComponent(NOTE)}`, { method: 'POST', headers: { Origin: studio.origin } })).status).toBe(405);
  });

  it('answers a path that is on neither side as not found', async () => {
    expect((await diff('content/notes/streaming/never.mdx')).status).toBe(404);
  });

  it('has no base without a main to compare with', async () => {
    git(studio.root, 'update-ref', '-d', 'refs/remotes/origin/main');
    git(studio.root, 'branch', '--quiet', '-D', 'main');
    expect(await diffOf(NOTE)).toMatchObject({ base: null, status: 'A', before: null, after: { kind: 'text' } });
    expect((await blob(PIXEL)).status).toBe(404);
  });
});
