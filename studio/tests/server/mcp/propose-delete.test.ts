import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Conversation, ConversationEvent } from '../../../server/agents/shared';
import type { ChangeRequest } from '../../../server/cr/manager';
import type { DeleteProposalView, ProposalView } from '../../../server/proposals/shared';
import { fakeProfile, messagesOf } from '../../support/agents';
import { sender } from '../../support/auth';
import { makeGitRepo, startCrStudio, type CrStudio, type GitRepo } from '../../support/git-repo';
import { json } from '../../support/http';

type DryRun = { changes: { type: string; path: string; detail?: string }[]; base: string; links: { note: string; line: number; href: string }[] };

const OLD = 'guide/old.mdx';

// propose_delete through the real MCP server: the agent only proposes, a
// person accepts with the dry run's base (the tree's own delete) or rejects.
describe('propose_delete', () => {
  let repo: GitRepo;
  let studio: CrStudio;
  let cr: ChangeRequest;
  let client: Client;
  const send = (path: string, method = 'GET', body?: unknown) => sender(studio.origin)(path, { method, body });
  const worktree = (path: string) => join(cr.worktree ?? '', path);
  const exists = (path: string) => stat(worktree(path)).then(() => true, () => false);
  const put = async (path: string, content: string | Buffer) => {
    await mkdir(dirname(worktree(path)), { recursive: true });
    await writeFile(worktree(path), content);
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    return { error: result.isError === true, text: result.content.map((part) => (part.type === 'text' ? part.text : '')).join(''), value: result.structuredContent };
  };
  const deletes = async () => (json(await send(`/cr/${cr.slug}/api/delete-proposals`)) as { proposals: DeleteProposalView[] }).proposals;
  const dryRun = async (path: string) => json(await send(`/cr/${cr.slug}/api/tree`, 'POST', { op: 'delete', path, dryRun: true })) as DryRun;
  const decide = (id: string, body: unknown) => send(`/cr/${cr.slug}/api/delete-proposals/${id}`, 'POST', body);

  async function runAgent(prompt: string, role = 'author') {
    const { conversation: run } = json(await send(`/cr/${cr.slug}/api/agents/conversations`, 'POST', { agent: 'claude', role, prompt })) as { conversation: Conversation };
    const deadline = Date.now() + 15_000;
    for (;;) {
      const read = json(await send(`/cr/${cr.slug}/api/agents/conversations/${run.id}`)) as { conversation: Conversation; events: ConversationEvent[] };
      if (read.conversation.status !== 'running') return { run: read.conversation, events: read.events, said: messagesOf(read.events).join('\n') };
      if (Date.now() > deadline) throw new Error('the run did not end');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  beforeAll(async () => {
    repo = await makeGitRepo();
    studio = await startCrStudio(repo, { agents: [fakeProfile()] });
    cr = (json(await send('/api/crs', 'POST', { name: 'Delete proposals' })) as { cr: ChangeRequest }).cr;
    await put('content/notes/guide/meta.yaml', 'title: Guide\npages:\n  - first-look\n  - old\n  - shelf\n');
    await put(`content/notes/${OLD}`, '---\ntitle: Old\n---\n\nOld text.\n\n![a](/notes/guide/old/a.png)\n');
    await put('content/notes/guide/first-look.mdx', '---\ntitle: First look\n---\n\nA first look. See [old](./old.mdx).\n');
    await put('public/notes/guide/old/a.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await put('content/notes/guide/shelf/meta.yaml', 'title: Shelf\npages: [one]\n');
    await put('content/notes/guide/shelf/one.mdx', '---\ntitle: One\n---\n\nOne.\n');
    client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${studio.origin}/api/mcp`)));
  }, 30_000);

  afterAll(async () => {
    await client.close();
    await studio.close();
    await repo.remove();
  });

  it('proposes a delete with what it takes, and deletes nothing', async () => {
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('propose_delete');
    const proposed = await call('propose_delete', { cr: cr.slug, path: `content/notes/${OLD}`, summary: 'Superseded by first look.' });
    expect(proposed.error).toBe(false);
    expect(proposed.value).toMatchObject({
      path: OLD,
      state: 'open',
      deleted: [OLD],
      changes: [
        { type: 'delete', path: OLD },
        { type: 'change', path: 'guide/meta.yaml', detail: 'removes "old"' },
        { type: 'delete', path: 'public/notes/guide/old/a.png' },
      ],
      linksLeft: [{ note: 'guide/first-look.mdx', line: 5, href: './old.mdx' }],
    });
    expect(await exists(`content/notes/${OLD}`)).toBe(true);
    expect(await deletes()).toEqual([expect.objectContaining({ path: OLD, state: 'open', summary: 'Superseded by first look.', by: { kind: 'person', login: null } })]);
  });

  it('keeps one open proposal per path', async () => {
    const [before] = await deletes();
    await call('propose_delete', { cr: cr.slug, path: OLD, summary: 'Still superseded.' });
    expect(await deletes()).toEqual([expect.objectContaining({ id: before.id, summary: 'Still superseded.' })]);
  });

  it('refuses a reviewer run and main, and a page that is not there', async () => {
    const reviewer = await runAgent(`mcp propose_delete {"path": "${OLD}"}`, 'reviewer');
    expect(reviewer.said).toContain('mcp-error:propose_delete is for an author');
    expect((await call('propose_delete', { cr: '_main', path: OLD })).text).toMatch(/main is read only/);
    expect((await call('propose_delete', { cr: cr.slug, path: 'guide/nope.mdx' })).text).toMatch(/no such page or folder/);
  }, 30_000);

  it("records an author run's proposal in its transcript", async () => {
    const author = await runAgent('mcp propose_delete {"path": "guide/shelf", "summary": "Empty shelf."}');
    expect(author.said).toMatch(/^mcp:/);
    const shelf = (await deletes()).find((proposal) => proposal.path === 'guide/shelf');
    expect(shelf?.by).toMatchObject({ kind: 'run', runId: author.run.id });
    expect(author.events).toContainEqual(expect.objectContaining({ type: 'delete-proposal', id: shelf?.id, path: 'guide/shelf' }));
  }, 30_000);

  it('accepts with the base of the dry run shown: the delete runs, edits on the note are dropped', async () => {
    const edit = (json(await send(`/cr/${cr.slug}/api/proposals`)) as { proposals: ProposalView[] }).proposals;
    expect(edit).toEqual([]);
    await call('propose_edit', { cr: cr.slug, path: `content/notes/${OLD}`, edits: [{ find: 'Old text.', replace: 'Older text.' }] });
    const proposal = (await deletes()).find((each) => each.path === OLD);
    if (proposal === undefined) throw new Error('no delete proposal for the old page');
    const { base } = await dryRun(OLD);
    expect((await decide(proposal.id, { op: 'accept' })).status).toBe(400);
    expect((await decide(proposal.id, { op: 'accept', base: 'stale' })).status).toBe(409);
    expect(await exists(`content/notes/${OLD}`)).toBe(true);

    const controller = new AbortController();
    const response = await fetch(`${studio.origin}/cr/${cr.slug}/api/proposals/events`, { signal: controller.signal });
    const reader = (response.body ?? new ReadableStream()).pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    while (!buffer.includes('retry:')) buffer += (await reader.read()).value ?? '';
    const accepted = await decide(proposal.id, { op: 'accept', base });
    expect(accepted.status).toBe(200);
    expect((json(accepted) as { proposal: DeleteProposalView }).proposal.state).toBe('accepted');
    while (!buffer.includes('event: delete-proposal')) buffer += (await reader.read()).value ?? '';
    controller.abort();

    expect(await exists(`content/notes/${OLD}`)).toBe(false);
    expect(await exists('public/notes/guide/old/a.png')).toBe(false);
    const { proposals } = json(await send(`/cr/${cr.slug}/api/proposals`)) as { proposals: ProposalView[] };
    expect(proposals.flatMap((each) => each.hunks.map((hunk) => hunk.state))).toEqual(['dropped']);
    expect((await decide(proposal.id, { op: 'reject' })).status).toBe(409);
  });

  it('rejects without touching the files', async () => {
    await put('content/notes/guide/spare.mdx', '---\ntitle: Spare\n---\n\nSpare.\n');
    const { value } = await call('propose_delete', { cr: cr.slug, path: 'guide/spare.mdx' });
    const rejected = await decide((value as { id: string }).id, { op: 'reject' });
    expect((json(rejected) as { proposal: DeleteProposalView }).proposal.state).toBe('rejected');
    expect(await exists('content/notes/guide/spare.mdx')).toBe(true);
  });

  it('settles an open proposal when the person deletes from the tree', async () => {
    const { base } = await dryRun('guide/shelf');
    expect((await send(`/cr/${cr.slug}/api/tree`, 'POST', { op: 'delete', path: 'guide/shelf', base })).status).toBe(200);
    expect((await deletes()).find((proposal) => proposal.path === 'guide/shelf')?.state).toBe('accepted');
  });
});
