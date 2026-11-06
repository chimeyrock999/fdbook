import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChangeRequest } from '#cr/manager.ts';
import { hrefFrom, relation } from '#mcp/writing-tools.ts';
import { sender } from '#tests/support/auth.ts';
import { makeGitRepo, startCrStudio, type CrStudio, type GitRepo } from '#tests/support/git-repo.ts';
import { json } from '#tests/support/http.ts';

const NOTES: Record<string, string> = {
  'content/docs/data/spark.mdx': '---\ntitle: Spark driver\ntags: [spark, compute]\nkeywords: [driver]\ngraph:\n  id: spark\n  displayName: Spark\n  keywords:\n    - id: dag\n      displayName: DAG\n---\n\nThe driver plans the DAG and hands tasks to executors. See [Photon](./photon.mdx).\n',
  'content/docs/data/photon.mdx': '---\ntitle: Photon engine\ntags: [compute]\nkeywords: [driver]\n---\n\nPhoton runs SQL faster.\n',
  'content/docs/data/executors.mdx': '---\ntitle: Executors\ntags: [spark]\n---\n\nExecutors run tasks. Back to [the driver](./spark.mdx).\n',
  'content/docs/other/cooking.mdx': '---\ntitle: Cooking rice\n---\n\nRice and water.\n',
  'content/docs/other/dag.mdx': '---\ntitle: Tasks and executors\ngraph:\n  id: dags\n  displayName: DAGs\n  sections:\n    - id: s\n      displayName: S\n      keywords:\n        - id: dag\n          displayName: DAG\n---\n\nA graph of tasks.\n',
};

// The tools for writing with an agent (#86): the notes' vocabulary, and
// the notes a note could link to.
describe('writing tools', () => {
  let repo: GitRepo;
  let studio: CrStudio;
  let cr: ChangeRequest;
  let client: Client;

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await client.callTool({ name, arguments: { cr: cr.slug, ...args } })) as CallToolResult;
    return { error: result.isError === true, value: result.structuredContent, text: result.content.map((part) => (part.type === 'text' ? part.text : '')).join('') };
  };

  beforeAll(async () => {
    repo = await makeGitRepo();
    studio = await startCrStudio(repo);
    cr = (json(await sender(studio.origin)('/api/crs', { method: 'POST', body: { name: 'Writing' } })) as { cr: ChangeRequest }).cr;
    for (const [path, content] of Object.entries(NOTES)) {
      const at = join(cr.worktree ?? '', path);
      await mkdir(dirname(at), { recursive: true });
      await writeFile(at, content);
    }
    client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${studio.origin}/api/mcp`)));
  }, 30_000);

  afterAll(async () => {
    await client.close();
    await studio.close();
    await repo.remove();
  });

  it('counts the tags, keywords and graph keywords the notes use, most used first', async () => {
    const { value } = await call('note_vocabulary', {});
    expect(value?.tags).toEqual([{ tag: 'compute', notes: 2 }, { tag: 'spark', notes: 2 }]);
    expect(value?.keywords).toEqual([{ keyword: 'driver', notes: 2 }]);
    expect(value?.graphKeywords).toEqual([{ id: 'dag', displayName: 'DAG', notes: 2 }]);
  });

  it('ranks the related notes with why, the href to write, and whether it already links there', async () => {
    const { value } = await call('related_notes', { path: 'data/spark.mdx' });
    const related = value?.related as { path: string; href: string; score: number; reasons: string[]; linked: boolean }[];
    expect(related.map((each) => each.path)).toEqual(['content/docs/data/photon.mdx', 'content/docs/data/executors.mdx', 'content/docs/other/dag.mdx']);
    expect(related[1]).toMatchObject({ href: './executors.mdx', linked: false, reasons: ['tag spark', 'it links to this note', 'its title\'s words in this note: executors'] });
    expect(related[0]).toMatchObject({ score: 8, href: './photon.mdx', linked: true, reasons: ['tag compute', 'keyword driver', 'this note links to it', 'its title\'s words in this note: photon'] });
    expect(related[2]).toMatchObject({ href: '../other/dag.mdx', reasons: ['keyword dag', 'its title\'s words in this note: tasks, executors'] });
    expect((await call('related_notes', { path: 'data/spark.mdx', limit: 1 })).value?.related).toHaveLength(1);
    expect((await call('related_notes', { path: 'data/missing.mdx' })).text).toMatch(/no such note/);
  });

  it('counts a tag once however often a note lists it, and no small words of a title', () => {
    const note = (path: string, data: Record<string, unknown>) => ({ path, data, mtimeMs: null });
    const self = note('a.mdx', { tags: ['spark'] });
    const other = note('b.mdx', { tags: ['spark', 'spark'], title: 'The driver and the DAG' });
    expect(relation(self, other, new Set(['the', 'and', 'driver']), { to: false, from: false })).toEqual({ score: 4, reasons: ['tag spark', 'its title\'s words in this note: driver'] });
  });

  it('writes a link as the notes do, relative to the note', () => {
    expect(hrefFrom('a/b.mdx', 'a/c.mdx')).toBe('./c.mdx');
    expect(hrefFrom('a/b.mdx', 'd/e.mdx')).toBe('../d/e.mdx');
    expect(hrefFrom('top.mdx', 'a/c.mdx')).toBe('./a/c.mdx');
  });
});
