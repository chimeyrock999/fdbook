import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { git } from '#infra/command.ts';
import type { Conversation } from '@fdbook/shared/agents.ts';
import type { ChangeRequest } from '#services/cr/manager.ts';
import type { ProposalView } from '@fdbook/shared/proposals.ts';
import type { Thread } from '@fdbook/shared/review.ts';
import { fakeProfile, messagesOf } from '#tests/support/agents.ts';
import { sender } from '#tests/support/auth.ts';
import { makeGitRepo, startCrStudio, type CrStudio, type GitRepo } from '#tests/support/git-repo.ts';
import { json } from '#tests/support/http.ts';

const NOTE = 'content/docs/guide/first-look.mdx';
const TEXT = '---\ntitle: First look\n---\n\nA first look.\n\nThe second paragraph.\n\nThe third paragraph.\n';

const textOf = (result: unknown) => (result as CallToolResult).content.map((part) => (part.type === 'text' ? part.text : '')).join('');

describe('review threads over MCP', () => {
  let repo: GitRepo;
  let studio: CrStudio;
  let cr: ChangeRequest;
  let client: Client;
  const send = (path: string, method = 'GET', body?: unknown) => sender(studio.origin)(path, { method, body });
  const worktree = (path: string) => join(cr.worktree ?? '', path);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await client.callTool({ name, arguments: { cr: cr.slug, ...args } })) as CallToolResult;
    return { error: result.isError === true, text: textOf(result), value: result.structuredContent as Record<string, unknown> };
  };
  const threadOf = async (id: string) => (json(await send(`/cr/${cr.slug}/api/threads/${id}`)) as { thread: Thread }).thread;
  // Waits for the server to see the note change on disk.
  async function until(id: string, done: (thread: Thread) => boolean) {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const thread = await threadOf(id);
      if (done(thread)) return thread;
      if (Date.now() > deadline) throw new Error(`thread ${id} did not get there: ${JSON.stringify(thread)}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  async function runAgent(prompt: string, role: 'author' | 'reviewer') {
    const { conversation: run } = json(await send(`/cr/${cr.slug}/api/agents/conversations`, 'POST', { agent: 'claude', role, prompt })) as { conversation: Conversation };
    const deadline = Date.now() + 15_000;
    for (;;) {
      const read = json(await send(`/cr/${cr.slug}/api/agents/conversations/${run.id}`)) as { conversation: Conversation; events: Parameters<typeof messagesOf>[0] };
      if (read.conversation.status !== 'running') return { run: read.conversation, said: messagesOf(read.events).join('\n') };
      if (Date.now() > deadline) throw new Error('the run did not end');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  beforeAll(async () => {
    repo = await makeGitRepo();
    studio = await startCrStudio(repo, { agents: [fakeProfile()] });
    cr = (json(await send('/api/crs', 'POST', { name: 'Review threads' })) as { cr: ChangeRequest }).cr;
    await writeFile(worktree(NOTE), TEXT);
    client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${studio.origin}/api/mcp`)));
  }, 30_000);

  afterAll(async () => {
    await client.close();
    await studio.close();
    await repo.remove();
  });

  it('lets a reviewer run open a blocking thread with a suggestion, badged with its model and role', async () => {
    const reviewer = await runAgent(`mcp add_comment {"path": "${NOTE}", "block": 2, "body": "Too vague.", "severity": "blocking", "rule": "voice.direct", "suggestion": {"edits": [{"find": "The second paragraph.", "replace": "The second paragraph, sharper."}], "summary": "Sharper"}}`, 'reviewer');
    expect(reviewer.said).toMatch(/^mcp:/);
    const { threads } = json(await send(`/cr/${cr.slug}/api/threads?path=${NOTE}`)) as { threads: Thread[] };
    const thread = threads.at(-1);
    expect(thread).toMatchObject({ severity: 'blocking', rule: 'voice.direct', state: 'open', anchor: { index: 2, text: 'The second paragraph.' } });
    expect(thread?.comments[0].by).toEqual({ kind: 'run', runId: reviewer.run.id, agent: 'claude', model: 'Fake One', role: 'reviewer' });
    // The suggestion is a proposal of the reviewer's, waiting for a person.
    const { proposal } = json(await send(`/cr/${cr.slug}/api/proposals/${thread?.suggestion ?? ''}`)) as { proposal: ProposalView };
    expect(proposal).toMatchObject({ path: NOTE, summary: 'Sharper', by: { kind: 'run', runId: reviewer.run.id } });
    await send(`/cr/${cr.slug}/api/proposals/${proposal.id}`, 'POST', { op: 'drop' });
  }, 30_000);

  it('holds each agent to its part: the author answers, the reviewer judges', async () => {
    const { id } = (await call('add_comment', { path: NOTE, block: 3, body: 'Say why.', severity: 'nit' })).value as { id: string };
    const author = await runAgent([
      `mcp set_thread_state {"thread": "${id}", "state": "resolved"}`,
      `mcp set_thread_state {"thread": "${id}", "state": "rejected"}`,
      `mcp set_thread_state {"thread": "${id}", "state": "addressed", "suggestion": "nope"}`,
      `mcp propose_edit {"path": "${NOTE}", "edits": [{"find": "The third paragraph.", "replace": "The third paragraph, and why."}]}`,
    ].join('\n'), 'author');
    expect(author.said).toContain('mcp-error:the author agent cannot take a thread from open to resolved (it may go to addressed, rejected)');
    expect(author.said).toContain('mcp-error:say why the thread is rejected');
    expect(author.said).toContain('mcp-error:no proposal nope on this thread\'s note');
    const proposal = /"id": "([^"]+)"/.exec(author.said)?.[1] ?? '';
    const answered = await runAgent(`mcp set_thread_state {"thread": "${id}", "state": "addressed", "body": "Done.", "suggestion": "${proposal}"}`, 'author');
    expect(answered.said).toMatch(/^mcp:/);
    expect(await threadOf(id)).toMatchObject({ state: 'addressed', suggestion: proposal });
    const judged = await runAgent(`mcp set_thread_state {"thread": "${id}", "state": "addressed"}\nmcp set_thread_state {"thread": "${id}", "state": "open", "body": "Not yet."}\nmcp reply_to_thread {"thread": "${id}", "body": "See the second sentence."}`, 'reviewer');
    expect(judged.said).toContain('mcp-error:the reviewer agent cannot take a thread from addressed to addressed');
    const thread = await threadOf(id);
    expect(thread.state).toBe('open');
    expect(thread.comments.map((comment) => [comment.by.kind === 'run' ? comment.by.role : 'person', comment.state ?? null, comment.body])).toEqual([
      ['person', null, 'Say why.'],
      ['author', 'addressed', 'Done.'],
      ['reviewer', 'open', 'Not yet.'],
      ['reviewer', null, 'See the second sentence.'],
    ]);
    await send(`/cr/${cr.slug}/api/proposals/${proposal}`, 'POST', { op: 'drop' });
  }, 60_000);

  it('lists threads by state and severity, the resolved ones only when asked', async () => {
    const { id } = (await call('add_comment', { path: NOTE, body: 'On the whole note.' })).value as { id: string };
    await call('set_thread_state', { thread: id, state: 'resolved' });
    const ids = async (args: Record<string, unknown>) => ((await call('list_threads', args)).value.threads as { id: string }[]).map((each) => each.id);
    expect(await ids({})).not.toContain(id);
    expect(await ids({ state: 'resolved' })).toEqual([id]);
    expect(await ids({ state: 'all', path: 'guide/first-look.mdx' })).toContain(id);
    expect((await call('list_threads', { severity: 'blocking' })).value.threads).toEqual([expect.objectContaining({ severity: 'blocking', block: 2, quote: 'The second paragraph.' })]);
  });

  it('keeps a thread on its block as the note changes on disk, and orphans it when the block goes', async () => {
    const { id } = (await call('add_comment', { path: NOTE, block: 2, body: 'Follow me.' })).value as { id: string };
    // An edit to the block and a paragraph before it, written straight to disk.
    await writeFile(worktree(NOTE), TEXT.replace('A first look.\n\n', 'A first look.\n\nA new paragraph.\n\n').replace('The second paragraph.', 'The second paragraph, edited.'));
    expect((await until(id, (thread) => thread.anchor?.index === 3)).anchor?.text).toBe('The second paragraph, edited.');
    await writeFile(worktree(NOTE), TEXT.replace('The second paragraph.\n\n', ''));
    expect((await until(id, (thread) => thread.orphaned)).anchor?.text).toBe('The second paragraph, edited.');
    // Back again: found again.
    await writeFile(worktree(NOTE), TEXT.replace('The second paragraph.', 'The second paragraph, edited.'));
    expect((await until(id, (thread) => !thread.orphaned)).anchor?.index).toBe(2);
    await writeFile(worktree(NOTE), TEXT);
  });

  it('answers what the change request changed against main, note hunks and lint included', async () => {
    await mkdir(dirname(worktree('content/docs/guide/new.mdx')), { recursive: true });
    await writeFile(worktree('content/docs/guide/new.mdx'), '---\ntitle: New\n---\n\nA new note.\n');
    await rm(worktree('content/docs/guide/index.mdx'));
    await git(cr.worktree ?? '', 'add', '-A');
    await git(cr.worktree ?? '', 'commit', '--quiet', '-m', 'Work');
    await writeFile(worktree('content/docs/index.mdx'), '---\ntitle: Home\n---\n\nWelcome home.\n');
    const { files } = (await call('cr_changes', {})).value as { files: { path: string; status: string; hunks?: { removed: string; added: string }[] | null }[] };
    expect(files.map((file) => [file.path, file.status])).toEqual([
      ['content/docs/guide/first-look.mdx', 'M'],
      ['content/docs/guide/index.mdx', 'D'],
      ['content/docs/guide/new.mdx', 'A'],
      ['content/docs/index.mdx', 'M'],
    ]);
    expect(files.find((file) => file.path === 'content/docs/index.mdx')?.hunks).toEqual([expect.objectContaining({ removed: expect.stringContaining('Welcome.') as string, added: expect.stringContaining('Welcome home.') as string })]);
  });

  it('opens and moves threads from the page as the person signed in', async () => {
    const opened = await send(`/cr/${cr.slug}/api/threads`, 'POST', { path: NOTE, anchor: null, body: 'From the page.', severity: 'blocking' });
    const { thread } = json(opened) as { thread: Thread };
    expect(thread).toMatchObject({ severity: 'blocking', anchor: null, comments: [{ by: { kind: 'person', login: null } }] });
    expect((await send(`/cr/${cr.slug}/api/threads/${thread.id}/state`, 'POST', { state: 'rejected' })).status).toBe(400);
    expect((await send(`/cr/${cr.slug}/api/threads/${thread.id}/state`, 'POST', { state: 'rejected', body: 'Fine as is.' })).status).toBe(200);
    expect((await send(`/cr/${cr.slug}/api/threads/${thread.id}/comments`, 'POST', { body: 'One more thing.' })).status).toBe(200);
    expect((await send(`/cr/${cr.slug}/api/threads`, 'POST', { path: 'content/docs/nope.mdx', anchor: null, body: 'x' })).status).toBe(404);
    expect((await send(`/cr/${cr.slug}/api/threads`, 'POST', { path: NOTE, anchor: { index: 'x' }, body: 'x' })).status).toBe(400);
    expect((await send(`/cr/${cr.slug}/api/threads/nope/comments`, 'POST', { body: 'x' })).status).toBe(404);
  });

  it('leaves no suggestion behind when it refuses the comment', async () => {
    const before = (json(await send(`/cr/${cr.slug}/api/proposals`)) as { proposals: ProposalView[] }).proposals.length;
    const suggestion = { edits: [{ find: 'A first look.', replace: 'A look.' }] };
    expect((await call('add_comment', { path: NOTE, block: 99, body: 'x', suggestion })).text).toMatch(/has 4 blocks/);
    expect((await call('add_comment', { path: NOTE, block: 1, body: 'x', rule: 'Not A Code', suggestion })).text).toMatch(/checklist code/);
    expect((json(await send(`/cr/${cr.slug}/api/proposals`)) as { proposals: ProposalView[] }).proposals).toHaveLength(before);
  });

  // Last: it renames the note the other tests use.
  it('moves a note\'s threads with it when the tree renames it', async () => {
    const { id } = (await call('add_comment', { path: NOTE, block: 1, body: 'Come along.' })).value as { id: string };
    const renamed = await send(`/cr/${cr.slug}/api/tree`, 'POST', { op: 'rename', path: 'guide/first-look.mdx', slug: 'look' });
    expect(renamed.status).toBe(200);
    const moved = await until(id, (thread) => thread.path === 'content/docs/guide/look.mdx');
    // The new file's add event finds the block there; the old one's unlink orphans nothing.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await threadOf(id)).toMatchObject({ path: moved.path, orphaned: false, anchor: { index: 1 } });
  });
});
