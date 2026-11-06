import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseDeletions, placeOf, titleOf, wasShown } from '../../../server/git/deleted-pages';
import { git } from '../../support/git';
import { json, rawRequest } from '../../support/http';
import { startTestStudio, type TestStudio } from '../../support/studio';

type DeletedPage = { path: string; title: string; sha: string; message: string; folderGone: boolean; committed: boolean };
type Restore = { path: string; open: string; changes: { type: string; path: string; detail?: string }[] };

const LAB = 'content/docs/restore-lab';
const SHELF = 'content/docs/lost-shelf';
// A folder that lists its index as a child, and that no meta.yaml above lists.
const IDX = 'content/docs/idx-shelf';
const ROOT_META = 'content/docs/meta.yaml';
const page = (title: string, body: string) => `---\ntitle: ${title}\n---\n\n${body}\n`;

describe('deleted pages helpers', () => {
  it('reads each commit with the files it deleted', () => {
    const output = `\x1e${'a'.repeat(40)}\x1f2026-10-01T10:00:00+07:00\x1fAn Author\x1fdrop two\0\nd/x.mdx\0d/y.mdx\0\x1e${'b'.repeat(40)}\x1f2026-09-01T10:00:00+07:00\x1fAn Author\x1fdrop one\0\nd/z.mdx\0`;
    expect(parseDeletions(output)).toEqual([
      { sha: 'a'.repeat(40), date: '2026-10-01T10:00:00+07:00', author: 'An Author', message: 'drop two', paths: ['d/x.mdx', 'd/y.mdx'] },
      { sha: 'b'.repeat(40), date: '2026-09-01T10:00:00+07:00', author: 'An Author', message: 'drop one', paths: ['d/z.mdx'] },
    ]);
  });

  it('takes the title from the frontmatter, else the file name', () => {
    expect(titleOf(page('Kept title', 'x'), 'a/b.mdx')).toBe('Kept title');
    expect(titleOf('no frontmatter', 'a/plain-name.mdx')).toBe('plain-name');
    expect(titleOf('---\ntitle: [unclosed\n---\n', 'a/broken.mdx')).toBe('broken');
  });

  it('places an entry after the one before it that is still listed, first, or last', () => {
    expect(placeOf(['a', 'c'], ['a', 'b', 'c'], 'b')).toBe(1);
    expect(placeOf(['c', 'a'], ['x', 'a', 'b'], 'b')).toBe(2);
    expect(placeOf(['c'], ['x', 'b', 'c'], 'b')).toBe(0);
    expect(placeOf(['c'], ['c'], 'b')).toBe(1);
    expect(placeOf(['c'], null, 'b')).toBe(1);
  });

  it('lists an entry again only where the list showed it before the delete', () => {
    expect(wasShown(['a', 'b'], 'b')).toBe(true);
    expect(wasShown(['a', '!b'], 'b')).toBe(true);
    expect(wasShown(['a', '...'], 'b')).toBe(true);
    expect(wasShown(null, 'b')).toBe(true);
    expect(wasShown(['a'], 'b')).toBe(false);
  });
});

// Deleted pages (#114) through the real server, on a git worktree copy of
// content/docs. A lab folder loses a page; a whole shelf folder goes; a
// page is renamed, another deleted and made again. The tests run in order.
describe('page history API: deleted pages', () => {
  let studio: TestStudio;
  let betaFirst: string;
  let betaSecond: string;
  let dropBeta: string;
  let retire: string;
  let rootMeta: string;

  const at = (path: string) => join(studio.root, path);
  const read = (path: string) => readFile(at(path), 'utf8');
  const exists = (path: string) => stat(at(path)).then(() => true, () => false);
  const commit = (message: string) => {
    git(studio.root, 'add', '-A');
    git(studio.root, 'commit', '--quiet', '-m', message);
    return git(studio.root, 'rev-parse', 'HEAD').trim();
  };
  const deleted = async () => {
    const response = await rawRequest(`${studio.url}api/history/deleted`);
    expect(response.status).toBe(200);
    return (json(response) as { pages: DeletedPage[] }).pages;
  };
  const restore = (body: unknown, headers: Record<string, string> = {}) =>
    rawRequest(`${studio.url}api/history/restore-deleted`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: studio.origin, ...headers },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    studio = await startTestStudio({ git: true });
    rootMeta = await read(ROOT_META);
    await mkdir(at(LAB), { recursive: true });
    await mkdir(at(SHELF), { recursive: true });
    await writeFile(at(`${LAB}/meta.yaml`), 'title: "Restore lab"\npages:\n  - "alpha"\n  - "beta"\n  - "gamma"\n');
    for (const name of ['alpha', 'gamma', 'delta']) await writeFile(at(`${LAB}/${name}.mdx`), page(name, name));
    await writeFile(at(`${LAB}/beta.mdx`), page('Beta', 'First beta.'));
    await writeFile(at(`${SHELF}/index.mdx`), page('Lost shelf', 'The shelf.'));
    await writeFile(at(`${SHELF}/meta.yaml`), 'title: "Lost shelf"\nicon: "Book"\npages:\n  - "one"\n  - "---Later---"\n  - "two"\n');
    await writeFile(at(`${SHELF}/one.mdx`), page('Shelf one', 'One.'));
    await writeFile(at(`${SHELF}/two.mdx`), page('Shelf two', 'Two.'));
    await writeFile(at(ROOT_META), rootMeta.replace('  - "distributed-systems"\n', '  - "distributed-systems"\n  - "lost-shelf"\n'));
    await mkdir(at(IDX), { recursive: true });
    await writeFile(at(`${IDX}/meta.yaml`), 'title: "Idx"\npages:\n  - "index"\n  - "one"\n  - "two"\n');
    for (const name of ['index', 'one', 'two']) await writeFile(at(`${IDX}/${name}.mdx`), page(`Idx ${name}`, name));
    betaFirst = commit('docs: add the lab and the shelf');
    await writeFile(at(`${LAB}/beta.mdx`), page('Beta', 'Second beta.'));
    betaSecond = commit('docs: second beta');
    await rm(at(`${LAB}/beta.mdx`));
    await writeFile(at(`${LAB}/meta.yaml`), 'title: "Restore lab"\npages:\n  - "alpha"\n  - "gamma"\n');
    dropBeta = commit('docs: drop beta');
    await rm(at(SHELF), { recursive: true });
    await rm(at(IDX), { recursive: true });
    await writeFile(at(ROOT_META), rootMeta);
    retire = commit('docs: retire the shelf');
    git(studio.root, 'mv', `${LAB}/gamma.mdx`, `${LAB}/gamma-two.mdx`);
    commit('docs: rename gamma');
    await rm(at(`${LAB}/delta.mdx`));
    commit('docs: drop delta');
    await writeFile(at(`${LAB}/delta.mdx`), page('delta', 'delta again'));
    commit('docs: delta again');
  });
  afterAll(async () => {
    await studio.close();
  });

  it('lists the pages deleted on HEAD, newest delete first, without renames and pages made again', async () => {
    const pages = (await deleted()).filter((each) => each.path.startsWith(`${LAB}/`) || each.path.startsWith(`${SHELF}/`));
    expect(pages.map(({ path, title, sha, message, folderGone }) => ({ path, title, sha, message, folderGone }))).toEqual([
      { path: `${SHELF}/index.mdx`, title: 'Lost shelf', sha: retire, message: 'docs: retire the shelf', folderGone: true },
      { path: `${SHELF}/one.mdx`, title: 'Shelf one', sha: retire, message: 'docs: retire the shelf', folderGone: true },
      { path: `${SHELF}/two.mdx`, title: 'Shelf two', sha: retire, message: 'docs: retire the shelf', folderGone: true },
      { path: `${LAB}/beta.mdx`, title: 'Beta', sha: dropBeta, message: 'docs: drop beta', folderGone: false },
    ]);
  });

  it('gives a deleted page its versions and the commit that deleted it', async () => {
    const response = await rawRequest(`${studio.url}api/history?${new URLSearchParams({ path: `${LAB}/beta.mdx` }).toString()}`);
    const history = json(response) as { mtimeMs: number | null; deleted: { sha: string; message: string } | null; versions: { sha: string }[] };
    expect(history.mtimeMs).toBeNull();
    expect(history.deleted).toMatchObject({ sha: dropBeta, message: 'docs: drop beta' });
    expect(history.versions.map((version) => version.sha)).toEqual([betaSecond, betaFirst]);
  });

  it('says what a restore writes on a dry run, and writes nothing', async () => {
    const before = await read(`${LAB}/meta.yaml`);
    const response = await restore({ path: `${LAB}/beta.mdx`, sha: betaFirst, dryRun: true });
    expect(response.status).toBe(200);
    expect(json(response)).toEqual({
      path: `${LAB}/beta.mdx`,
      open: `${LAB}/beta.mdx`,
      changes: [
        { type: 'add', path: `${LAB}/beta.mdx` },
        { type: 'change', path: `${LAB}/meta.yaml`, detail: 'adds "beta"' },
      ],
    } satisfies Restore);
    expect(await exists(`${LAB}/beta.mdx`)).toBe(false);
    expect(await read(`${LAB}/meta.yaml`)).toBe(before);
  });

  it('brings a page back as an older version, listed where it was', async () => {
    const response = await restore({ path: `${LAB}/beta.mdx`, sha: betaFirst });
    expect(response.status).toBe(200);
    expect(await read(`${LAB}/beta.mdx`)).toBe(page('Beta', 'First beta.'));
    expect(await read(`${LAB}/meta.yaml`)).toBe('title: "Restore lab"\npages:\n  - "alpha"\n  - "beta"\n  - "gamma"\n');
    expect(git(studio.root, 'status', '--porcelain', '--', LAB).split('\n').map((line) => line.trim()).filter(Boolean).sort()).toEqual([`?? ${LAB}/beta.mdx`, `M ${LAB}/meta.yaml`]);
    expect((await deleted()).some((each) => each.path === `${LAB}/beta.mdx`)).toBe(false);
  });

  it('brings back a page whose folder went with it: the folder page, its meta.yaml with only that page, and its entry above', async () => {
    const one = `${SHELF}/one.mdx`;
    const sha = (json(await rawRequest(`${studio.url}api/history?${new URLSearchParams({ path: one }).toString()}`)) as { versions: { sha: string }[] }).versions[0].sha;
    const response = await restore({ path: one, sha });
    expect(response.status).toBe(200);
    expect((json(response) as Restore).changes).toEqual([
      { type: 'add', path: one },
      { type: 'add', path: `${SHELF}/meta.yaml` },
      { type: 'add', path: `${SHELF}/index.mdx` },
      { type: 'change', path: ROOT_META, detail: 'adds "lost-shelf"' },
    ]);
    expect(await read(one)).toBe(page('Shelf one', 'One.'));
    expect(await read(`${SHELF}/index.mdx`)).toBe(page('Lost shelf', 'The shelf.'));
    expect(await read(`${SHELF}/meta.yaml`)).toBe('title: "Lost shelf"\nicon: "Book"\npages:\n  - "one"\n  - "---Later---"\n');
    expect(await read(ROOT_META)).toBe(rootMeta.replace('  - "distributed-systems"\n', '  - "distributed-systems"\n  - "lost-shelf"\n'));
  });

  it('keeps a listed index in a folder it brings back, and leaves an unlisted folder unlisted above', async () => {
    const index = `${IDX}/index.mdx`;
    const before = await read(ROOT_META);
    const response = await restore({ path: index, sha: betaFirst });
    expect(response.status).toBe(200);
    expect((json(response) as Restore).changes).toEqual([{ type: 'add', path: index }, { type: 'add', path: `${IDX}/meta.yaml` }]);
    expect(await read(`${IDX}/meta.yaml`)).toBe('title: "Idx"\npages:\n  - "index"\n');
    // No meta.yaml above listed idx-shelf: it stays out of the sidebar.
    expect(await read(ROOT_META)).toBe(before);
    // The folder is back: the next page goes into its meta.yaml, where it was.
    expect((await restore({ path: `${IDX}/two.mdx`, sha: betaFirst })).status).toBe(200);
    expect(await read(`${IDX}/meta.yaml`)).toBe('title: "Idx"\npages:\n  - "index"\n  - "two"\n');
  });

  it('keeps the index entry when a page of the folder comes back with its index', async () => {
    await rm(at(IDX), { recursive: true });
    const response = await restore({ path: `${IDX}/one.mdx`, sha: betaFirst });
    expect((json(response) as Restore).changes.map((change) => change.path)).toEqual([`${IDX}/one.mdx`, `${IDX}/meta.yaml`, `${IDX}/index.mdx`]);
    expect(await read(`${IDX}/meta.yaml`)).toBe('title: "Idx"\npages:\n  - "index"\n  - "one"\n');
  });

  it('lists a page deleted from the tree and not committed first, not a page renamed there, and restores it', async () => {
    const tree = (body: unknown) => rawRequest(`${studio.url}api/tree`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: studio.origin }, body: JSON.stringify(body) });
    const before = await read(`${LAB}/meta.yaml`);
    const { base } = json(await tree({ op: 'delete', path: 'restore-lab/alpha.mdx', dryRun: true })) as { base: string };
    expect((await tree({ op: 'delete', path: 'restore-lab/alpha.mdx', base })).status).toBe(200);
    // A folder of committed pages, renamed: its pages are moved, not deleted.
    expect((await tree({ op: 'rename', path: 'distributed-systems/mapreduce', slug: 'map-reduce' })).status).toBe(200);
    const pages = await deleted();
    expect(pages[0]).toMatchObject({ path: `${LAB}/alpha.mdx`, title: 'alpha', sha: betaFirst, committed: false, folderGone: false });
    expect(pages.filter((each) => !each.committed).map((each) => each.path)).toEqual([`${LAB}/alpha.mdx`]);
    expect(pages.find((each) => each.path === `${SHELF}/two.mdx`)?.committed).toBe(true);
    expect((await restore({ path: `${LAB}/alpha.mdx`, sha: betaFirst })).status).toBe(200);
    expect(await read(`${LAB}/alpha.mdx`)).toBe(page('alpha', 'alpha'));
    expect(await read(`${LAB}/meta.yaml`)).toBe(before);
    expect((await deleted()).some((each) => !each.committed)).toBe(false);
  });

  it('refuses a page that is in the worktree, a version not of the page, a path that is no page and a cross-site post', async () => {
    expect((await restore({ path: `${LAB}/alpha.mdx`, sha: betaFirst })).status).toBe(409);
    expect((await restore({ path: `${SHELF}/two.mdx`, sha: dropBeta })).status).toBe(404);
    expect((await restore({ path: `${SHELF}/two.mdx`, sha: 'HEAD' })).status).toBe(400);
    expect((await restore({ path: `${LAB}/meta.yaml`, sha: betaFirst })).status).toBe(403);
    expect((await restore({ path: `${SHELF}/two.mdx`, sha: retire }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect(await exists(`${SHELF}/two.mdx`)).toBe(false);
  });
});
