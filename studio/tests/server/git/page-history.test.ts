import { readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePageLog } from '../../../server/git/page-history';
import { git } from '../../support/git';
import { json, rawRequest } from '../../support/http';
import { startTestStudio, type TestStudio } from '../../support/studio';

type Side = { kind: 'text'; text: string; size: number } | { kind: 'binary'; size: number };
type Version = { sha: string; date: string; author: string; message: string; path: string; status: string; from?: string; inChangeRequest: boolean };
type PageHistory = { path: string; mtimeMs: number | null; versions: Version[] };
type Comparison = { path: string; from: { version: string; path: string } | null; to: { version: string; path: string }; before: Side | null; after: Side | null };

const OLD = 'content/docs/streaming/history-old.mdx';
const PAGE = 'content/docs/streaming/history-page.mdx';
const first = '---\ntitle: History\n---\n\nFirst version.\n';
const second = '---\ntitle: History\n---\n\nSecond version.\n';
const third = '---\ntitle: History\n---\n\nThird version, in the change request.\n';

describe('parsePageLog', () => {
  it('reads each commit with the path it had there, a rename with its old name', () => {
    const record = (sha: string, rest: string) => `\x1e${sha}\x1f2026-10-01T10:00:00+07:00\x1fAn Author\x1fmsg ${sha}\0${rest}`;
    const output = [
      record('c'.repeat(40), '\nM\0d/y.mdx\0'),
      record('b'.repeat(40), '\nR100\0d/x.mdx\0d/y.mdx\0'),
      record('a'.repeat(40), '\nA\0d/x.mdx\0'),
    ].join('');
    // A merge whose page is its own (--cc), and one that kept a parent's (no file).
    const merges = record('f'.repeat(40), '\0MM\0d/y.mdx\0') + record('0'.repeat(40), '\0');
    expect(parsePageLog(merges).map(({ sha, path, status }) => ({ sha, path, status }))).toEqual([{ sha: 'f'.repeat(40), path: 'd/y.mdx', status: 'M' }]);
    const changedType = record('d'.repeat(40), '\nT\0d/y.mdx\0');
    const copied = record('e'.repeat(40), '\nC075\0d/w.mdx\0d/y.mdx\0');
    expect(parsePageLog(changedType + copied).map(({ path, status, from }) => ({ path, status, from }))).toEqual([
      { path: 'd/y.mdx', status: 'M', from: undefined },
      { path: 'd/y.mdx', status: 'R', from: 'd/w.mdx' },
    ]);
    expect(parsePageLog(output)).toEqual([
      { sha: 'c'.repeat(40), date: '2026-10-01T10:00:00+07:00', author: 'An Author', message: `msg ${'c'.repeat(40)}`, path: 'd/y.mdx', status: 'M' },
      { sha: 'b'.repeat(40), date: '2026-10-01T10:00:00+07:00', author: 'An Author', message: `msg ${'b'.repeat(40)}`, path: 'd/y.mdx', status: 'R', from: 'd/x.mdx' },
      { sha: 'a'.repeat(40), date: '2026-10-01T10:00:00+07:00', author: 'An Author', message: `msg ${'a'.repeat(40)}`, path: 'd/x.mdx', status: 'A' },
    ]);
  });
});

// The page history API on a git worktree copy of content/docs, through the
// real server. One page is created and changed on main, renamed, then
// changed again in the change request. The tests run in order.
describe('page history API', () => {
  let studio: TestStudio;
  let created: string;
  let changed: string;
  let renamed: string;
  let own: string;

  const at = (path: string) => join(studio.root, path);
  const commit = (message: string) => {
    git(studio.root, 'add', '-A');
    git(studio.root, 'commit', '--quiet', '-m', message);
    return git(studio.root, 'rev-parse', 'HEAD').trim();
  };
  const history = (path: string) => rawRequest(`${studio.url}api/history?${new URLSearchParams({ path }).toString()}`);
  const historyOf = async (path: string) => {
    const response = await history(path);
    expect(response.status).toBe(200);
    return json(response) as PageHistory;
  };
  const compare = (query: Record<string, string>) => rawRequest(`${studio.url}api/history/compare?${new URLSearchParams(query).toString()}`);
  const comparisonOf = async (query: Record<string, string>) => {
    const response = await compare(query);
    expect(response.status).toBe(200);
    return json(response) as Comparison;
  };
  const restore = (body: unknown, headers: Record<string, string> = {}) =>
    rawRequest(`${studio.url}api/history/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: studio.origin, ...headers },
      body: JSON.stringify(body),
    });
  const mtimeOf = async (path: string) => (await stat(at(path))).mtimeMs;

  beforeAll(async () => {
    studio = await startTestStudio({ git: true });
    // Main's history, made on main itself, then the change request branches off again.
    git(studio.root, 'switch', '--quiet', 'main');
    await writeFile(at(OLD), first);
    created = commit('docs: add the history page');
    await writeFile(at(OLD), second);
    changed = commit('docs: second version');
    git(studio.root, 'mv', OLD, PAGE);
    renamed = commit('docs: rename the history page');
    git(studio.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(studio.root, 'switch', '--quiet', '-C', 'cr/test');
    await writeFile(at(PAGE), third);
    own = commit('docs: third version');
  });
  afterAll(async () => {
    await studio.close();
  });

  it('lists the page versions newest first, across the rename, and marks the change request own', async () => {
    const answer = await historyOf(PAGE);
    expect(answer.path).toBe(PAGE);
    expect(answer.mtimeMs).toBe(await mtimeOf(PAGE));
    expect(answer.versions.map(({ sha, path, status, from, inChangeRequest, message, author }) => ({ sha, path, status, from, inChangeRequest, message, author }))).toEqual([
      { sha: own, path: PAGE, status: 'M', from: undefined, inChangeRequest: true, message: 'docs: third version', author: 'Studio Test' },
      { sha: renamed, path: PAGE, status: 'R', from: OLD, inChangeRequest: false, message: 'docs: rename the history page', author: 'Studio Test' },
      { sha: changed, path: OLD, status: 'M', from: undefined, inChangeRequest: false, message: 'docs: second version', author: 'Studio Test' },
      { sha: created, path: OLD, status: 'A', from: undefined, inChangeRequest: false, message: 'docs: add the history page', author: 'Studio Test' },
    ]);
    expect(answer.versions[0].date).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('compares two versions, reading each under the name it had', async () => {
    expect(await comparisonOf({ path: PAGE, from: created, to: own })).toEqual({
      path: PAGE,
      from: { version: created, path: OLD },
      to: { version: own, path: PAGE },
      before: { kind: 'text', text: first, size: Buffer.byteLength(first) },
      after: { kind: 'text', text: third, size: Buffer.byteLength(third) },
    });
  });

  it('compares a version with the page now, uncommitted edits included', async () => {
    const now = `${third}\nNot committed.\n`;
    await writeFile(at(PAGE), now);
    expect(await comparisonOf({ path: PAGE, from: changed, to: 'now' })).toMatchObject({
      from: { version: changed, path: OLD },
      to: { version: 'now', path: PAGE },
      before: { kind: 'text', text: second },
      after: { kind: 'text', text: now },
    });
    // Without `from`, the version stands alone: nothing before it.
    expect(await comparisonOf({ path: PAGE, to: created })).toMatchObject({ from: null, before: null, after: { kind: 'text', text: first } });
  });

  it('answers a page not committed yet with no versions, and compares it as it is now', async () => {
    const fresh = 'content/docs/streaming/history-fresh.mdx';
    await writeFile(at(fresh), first);
    expect(await historyOf(fresh)).toEqual({ path: fresh, mtimeMs: await mtimeOf(fresh), deleted: null, versions: [] });
    expect(await comparisonOf({ path: fresh, to: 'now' })).toMatchObject({ from: null, before: null, after: { kind: 'text', text: first } });
    await rm(at(fresh));
  });

  it('refuses a version that is not the page, a bad sha and a path outside the notes', async () => {
    const unrelated = git(studio.root, 'rev-parse', 'HEAD~4').trim();
    expect((await compare({ path: PAGE, to: unrelated })).status).toBe(404);
    expect((await compare({ path: PAGE, to: 'HEAD' })).status).toBe(400);
    expect((await compare({ path: PAGE, to: created.slice(0, 7) })).status).toBe(400);
    expect((await compare({ path: PAGE })).status).toBe(400);
    expect((await history('package.json')).status).toBe(403);
    expect((await history('content/docs/streaming/meta.yaml')).status).toBe(403);
    expect((await history('content/docs/../package.json')).status).toBe(403);
    expect((await history('content/docs/streaming/never.mdx')).status).toBe(404);
    expect((await rawRequest(`${studio.url}api/history`)).status).toBe(400);
    await symlink(at(PAGE), at('content/docs/streaming/linked.mdx'));
    expect((await history('content/docs/streaming/linked.mdx')).status).toBe(403);
  });

  it('restores an old version into the page, uncommitted, under its current name', async () => {
    const response = await restore({ path: PAGE, sha: created, mtimeMs: await mtimeOf(PAGE) });
    expect(response.status).toBe(200);
    expect(json(response)).toEqual({ path: PAGE, mtimeMs: await mtimeOf(PAGE) });
    expect(await readFile(at(PAGE), 'utf8')).toBe(first);
    expect(git(studio.root, 'status', '--porcelain', '--', PAGE).trim()).toBe(`M ${PAGE}`);
    const changes = json(await rawRequest(`${studio.url}api/changes`)) as { files: { path: string; status: string }[] };
    expect(changes.files).toContainEqual({ path: PAGE, status: 'M' });
  });

  it('refuses to restore over a page that changed since it was read', async () => {
    const before = await mtimeOf(PAGE);
    await writeFile(at(PAGE), 'Edited elsewhere.\n');
    const response = await restore({ path: PAGE, sha: changed, mtimeMs: before - 1000 });
    expect(response.status).toBe(409);
    expect(json(response)).toEqual({ error: `${PAGE} changed on disk since it was read` });
    expect(await readFile(at(PAGE), 'utf8')).toBe('Edited elsewhere.\n');
  });

  it('refuses a bad restore body, a version not of the page and a cross-site post', async () => {
    const mtimeMs = await mtimeOf(PAGE);
    expect((await restore({ path: PAGE, sha: 'nope', mtimeMs })).status).toBe(400);
    expect((await restore({ path: PAGE, sha: changed })).status).toBe(400);
    expect((await restore({ path: 'package.json', sha: changed, mtimeMs })).status).toBe(403);
    expect((await restore({ path: PAGE, sha: git(studio.root, 'rev-parse', 'HEAD~4').trim(), mtimeMs })).status).toBe(404);
    expect((await restore({ path: PAGE, sha: changed, mtimeMs }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await rawRequest(`${studio.url}api/history/restore`, { method: 'POST', headers: { Origin: studio.origin }, body: '{}' })).status).toBe(415);
    expect((await rawRequest(`${studio.url}api/history`, { method: 'POST', headers: { Origin: studio.origin } })).status).toBe(405);
    expect(await readFile(at(PAGE), 'utf8')).toBe('Edited elsewhere.\n');
  });
  it('lists a merge whose page is none of its parents, and restores the merged text', async () => {
    git(studio.root, 'checkout', '--', PAGE);
    const lines = (second: string, sixth: string) => `---\ntitle: History\n---\n\na\n${second}\nc\nd\ne\n${sixth}\ng\n`;
    await writeFile(at(PAGE), lines('b', 'f'));
    const start = commit('docs: seven lines');
    git(studio.root, 'switch', '--quiet', '-c', 'side-one');
    await writeFile(at(PAGE), lines('B1', 'f'));
    commit('docs: side one');
    git(studio.root, 'switch', '--quiet', '-c', 'side-two', start);
    await writeFile(at(PAGE), lines('b', 'F2'));
    commit('docs: side two');
    git(studio.root, 'switch', '--quiet', 'cr/test');
    git(studio.root, 'merge', '--quiet', '--no-ff', '-m', 'Merge side-one', 'side-one');
    git(studio.root, 'merge', '--quiet', '--no-ff', '-m', 'Merge side-two', 'side-two');
    const merged = git(studio.root, 'rev-parse', 'HEAD').trim();
    const { versions, mtimeMs } = await historyOf(PAGE);
    // The first merge kept side one's page: no version of its own.
    expect(versions.map((version) => version.message).slice(0, 4)).toEqual(['Merge side-two', 'docs: side two', 'docs: side one', 'docs: seven lines']);
    expect(versions[0]).toMatchObject({ sha: merged, path: PAGE, status: 'M', inChangeRequest: true });
    expect((await restore({ path: PAGE, sha: start, mtimeMs })).status).toBe(200);
    const restored = await restore({ path: PAGE, sha: merged, mtimeMs: await mtimeOf(PAGE) });
    expect(restored.status).toBe(200);
    expect(await readFile(at(PAGE), 'utf8')).toBe(lines('B1', 'F2'));
  });
});
