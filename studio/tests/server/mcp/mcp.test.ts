import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { git } from '../../../server/cr/git';
import type { StudioTool } from '../../../server/mcp/tool';
import type { Conversation, TurnChange } from '../../../server/agents/shared';
import type { ChangeRequest } from '../../../server/cr/manager';
import type { Thread } from '../../../server/review/shared';
import type { ProposalView } from '../../../server/proposals/shared';
import { fakeProfile, messagesOf } from '../../support/agents';
import { fakeAuth, sender, signInWith } from '../../support/auth';
import { makeGitRepo, startCrStudio, type CrStudio, type GitRepo } from '../../support/git-repo';
import { json } from '../../support/http';
import { syncWith, TextEditor } from '../../support/sync';

const NOTE = 'content/docs/guide/first-look.mdx';

// A tool that writes through ctx.files, as the diagram tools (#82) do.
const WRITE_TOOL: StudioTool = {
  name: 'test_write',
  description: 'Writes a file',
  input: z.object({ path: z.string(), content: z.string() }),
  access: 'write',
  async run(args, ctx) {
    const { path, content } = args as { path: string; content: string };
    const { mtimeMs } = await ctx.files.write(path, content);
    return { content: [{ type: 'text', text: String(mtimeMs) }] };
  },
};

async function connect(origin: string, token?: string) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/api/mcp`), { requestInit: token === undefined ? {} : { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

const textOf = (result: unknown) => (result as CallToolResult).content.map((part) => (part.type === 'text' ? part.text : '')).join('');
const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  return { error: result.isError === true, text: textOf(result), value: result.structuredContent };
};

describe('Studio MCP server', () => {
  let repo: GitRepo;
  let studio: CrStudio;
  let cr: ChangeRequest;
  let client: Client;
  const send = (path: string, method = 'GET', body?: unknown) => sender(studio.origin)(path, { method, body });
  const worktree = (path: string) => join(cr.worktree ?? '', path);

  // Starts a conversation with the fake agent and waits for its first turn's end.
  async function runAgent(prompt: string, role = 'author', agent = 'claude') {
    const { conversation: run } = json(await send(`/cr/${cr.slug}/api/agents/conversations`, 'POST', { agent, role, prompt })) as { conversation: Conversation };
    const deadline = Date.now() + 15_000;
    for (;;) {
      const read = json(await send(`/cr/${cr.slug}/api/agents/conversations/${run.id}`)) as { conversation: Conversation; events: Parameters<typeof messagesOf>[0] };
      if (read.conversation.status !== 'running') return { run: read.conversation, events: read.events, said: messagesOf(read.events).join('\n') };
      if (Date.now() > deadline) throw new Error('the run did not end');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  beforeAll(async () => {
    repo = await makeGitRepo();
    studio = await startCrStudio(repo, { agents: [fakeProfile(), fakeProfile({ FAKE_MCP: 'http' }, 'codex')], tools: [WRITE_TOOL] });
    cr = (json(await send('/api/crs', 'POST', { name: 'Agent tools' })) as { cr: ChangeRequest }).cr;
    await writeFile(worktree('content/docs/guide/index.mdx'), '---\ntitle: Guide\ntags: [intro]\n---\n\nThe guide. See [first look](./first-look.mdx).\n');
    client = await connect(studio.origin);
  }, 30_000);

  afterAll(async () => {
    await client.close();
    await studio.close();
    await repo.remove();
  });

  it('lists the change request tools and the note tools, each note tool taking cr', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).filter((name) => !name.startsWith('diagram_')).sort()).toEqual(['add_comment', 'cr_changes', 'create_cr', 'list_assets', 'list_crs', 'list_notes', 'list_threads', 'note_graph', 'note_vocabulary', 'propose_delete', 'propose_edit', 'read_note', 'related_notes', 'reply_to_thread', 'search_notes', 'set_thread_state', 'test_write']);
    expect(tools.filter((tool) => tool.name.startsWith('diagram_'))).toHaveLength(14);
    expect(tools.find((tool) => tool.name === 'read_note')?.inputSchema.properties).toHaveProperty('cr');
    expect(tools.find((tool) => tool.name === 'list_crs')?.inputSchema.properties ?? {}).not.toHaveProperty('cr');
  });

  it('mounts the diagram tools (#82): a diagram created in the change request, drawn and checked', async () => {
    const content = {
      title: 'Pipeline',
      kinds: [{ id: 'step', label: 'Step', tone: 'blue' }],
      nodes: [{ id: 'read', kind: 'step', label: 'Read' }, { id: 'write', kind: 'step', label: 'Write' }],
      edges: [{ id: 'flow', from: 'read', to: 'write', label: 'rows' }],
    };
    const created = await call(client, 'diagram_create', { cr: cr.slug, src: 'guide/pipeline', content });
    expect(created.error).toBe(false);
    expect(JSON.parse(await readFile(worktree('diagrams/guide/pipeline.diagram.json'), 'utf8'))).toMatchObject({ title: 'Pipeline', layout: { nodes: { read: {}, write: {} } } });
    const drawn = (await client.callTool({ name: 'diagram_render_png', arguments: { cr: cr.slug, src: 'guide/pipeline', scale: 1 } })) as CallToolResult;
    expect(drawn.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect((await call(client, 'diagram_validate', { cr: cr.slug, src: 'guide/pipeline' })).text).toContain('No issues.');
    expect((await call(client, 'diagram_read', { cr: '_main', src: 'guide/pipeline' })).error).toBe(true);
  });

  it('refuses main, a missing or unknown change request, and paths outside the notes', async () => {
    for (const cr of [undefined, '_main', 'main', 'nope', '../x']) {
      expect((await call(client, 'read_note', { cr, path: NOTE })).error).toBe(true);
    }
    expect((await call(client, 'read_note', { cr: cr.slug, path: '../../package.json' })).text).toMatch(/not an editable path/);
    expect((await call(client, 'read_note', { cr: cr.slug, path: 'content/docs/.secret.mdx' })).text).toMatch(/not an editable path/);
    expect((await call(client, 'read_note', { cr: cr.slug, path: 'content/docs/missing.mdx' })).text).toMatch(/no such note/);
  });

  it('lists, creates and reads change requests and notes', async () => {
    const crs = await call(client, 'list_crs', {});
    expect(crs.value?.crs).toEqual(expect.arrayContaining([expect.objectContaining({ slug: cr.slug })]));
    const created = await call(client, 'create_cr', { name: 'From a terminal' });
    expect(created.value).toMatchObject({ slug: 'from-a-terminal' });
    const notes = await call(client, 'list_notes', { cr: cr.slug });
    expect(notes.value?.notes).toEqual(expect.arrayContaining([expect.objectContaining({ path: NOTE, title: 'First look' })]));
    const note = await call(client, 'read_note', { cr: cr.slug, path: 'guide/first-look.mdx' });
    expect(note.value).toMatchObject({ path: NOTE, content: '---\ntitle: First look\n---\n\nA first look.\n', blocks: [{ index: 0, line: 1 }, { index: 1, line: 5, preview: 'A first look.' }] });
  });

  it('searches, draws the graph and lists assets', async () => {
    const found = await call(client, 'search_notes', { cr: cr.slug, query: 'first look' });
    expect((found.value?.results as { path: string }[]).map((result) => result.path)).toEqual(expect.arrayContaining([NOTE, 'content/docs/guide/index.mdx']));
    const graph = await call(client, 'note_graph', { cr: cr.slug, path: NOTE });
    expect(graph.value).toMatchObject({ linksTo: [], linkedFrom: ['content/docs/guide/index.mdx'] });
    const index = await call(client, 'note_graph', { cr: cr.slug, path: 'content/docs/guide/index.mdx' });
    expect(index.value).toMatchObject({ linksTo: [NOTE], tags: ['intro'] });
    expect((await call(client, 'list_assets', { cr: cr.slug })).value).toEqual({ assets: [] });
  });

  it('turns propose_edit into a proposal a person accepts, never a write', async () => {
    const before = await readFile(worktree(NOTE), 'utf8');
    const proposed = await call(client, 'propose_edit', { cr: cr.slug, path: NOTE, edits: [{ find: 'A first look.', replace: 'A first look, tightened.' }], summary: 'Tighten' });
    expect(proposed.error).toBe(false);
    expect(await readFile(worktree(NOTE), 'utf8')).toBe(before);
    const { proposals } = json(await send(`/cr/${cr.slug}/api/proposals?path=${NOTE}`)) as { proposals: ProposalView[] };
    const proposal = proposals.find((each) => each.id === proposed.value?.id);
    expect(proposal).toMatchObject({ by: { kind: 'person', login: null }, summary: 'Tighten', stale: false });
    expect((await send(`/cr/${cr.slug}/api/proposals/${proposal?.id ?? ''}`, 'POST', { op: 'accept' })).status).toBe(200);
    expect(await readFile(worktree(NOTE), 'utf8')).toBe(before.replace('A first look.', 'A first look, tightened.'));
  });

  it('streams each proposal as it is made', async () => {
    const controller = new AbortController();
    const response = await fetch(`${studio.origin}/cr/${cr.slug}/api/proposals/events`, { signal: controller.signal });
    const reader = (response.body ?? new ReadableStream()).pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    while (!buffer.includes('retry:')) buffer += (await reader.read()).value ?? '';
    const proposed = await call(client, 'propose_edit', { cr: cr.slug, path: NOTE, edits: [{ find: 'tightened', replace: 'streamed' }] });
    while (!buffer.includes('data: ')) buffer += (await reader.read()).value ?? '';
    controller.abort();
    const data = JSON.parse(buffer.slice(buffer.indexOf('data: ') + 6).split('\n')[0] ?? '') as ProposalView;
    expect(data).toMatchObject({ id: proposed.value?.id, path: NOTE });
  });

  it('creates a note that does not exist yet, on the run\'s Keep/Revert list', async () => {
    const page = 'content/docs/guide/created.mdx';
    // A fix to the note the run created is written too, not proposed: the
    // note is still the run's own, on its Keep/Revert list.
    const run = await runAgent(`mcp propose_edit {"path": "${page}", "content": "---\\ntitle: Created\\n---\\n\\nNew.\\n"}\nmcp propose_edit {"path": "content/docs/guide/broken.mdx", "content": "<Broken"}\nmcp propose_edit {"path": "${page}", "edits": [{"find": "New.", "replace": "Newer."}]}`);
    expect(run.said).toMatch(/mcp:\{\n {2}"created": true/);
    expect(run.said).toMatch(/mcp-error:the new note does not parse/);
    expect(run.said).toMatch(/mcp:\{\n {2}"written": true/);
    expect(await readFile(worktree(page), 'utf8')).toBe('---\ntitle: Created\n---\n\nNewer.\n');
    const { proposals } = json(await send(`/cr/${cr.slug}/api/proposals?path=${page}`)) as { proposals: ProposalView[] };
    expect(proposals).toEqual([]);
    const { changes } = json(await send(`/cr/${cr.slug}/api/agents/conversations/${run.run.id}/turns/1/changes`)) as { changes: TurnChange[] };
    expect(changes).toEqual([{ path: page, existed: false, decided: null, reason: null }]);
  }, 20_000);

  it('opens review threads anchored to a block, and streams them', async () => {
    const controller = new AbortController();
    const response = await fetch(`${studio.origin}/cr/${cr.slug}/api/proposals/events`, { signal: controller.signal });
    const reader = (response.body ?? new ReadableStream()).pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    while (!buffer.includes('retry:')) buffer += (await reader.read()).value ?? '';
    const added = await call(client, 'add_comment', { cr: cr.slug, path: NOTE, block: 1, body: 'Say more here.', severity: 'nit' });
    expect(added.error).toBe(false);
    // Threads stream too, as `thread` events.
    while (!buffer.includes('event: thread')) buffer += (await reader.read()).value ?? '';
    controller.abort();
    expect(buffer).toContain('Say more here.');
    expect((await call(client, 'add_comment', { cr: cr.slug, path: NOTE, block: 9, body: 'x' })).text).toMatch(/has 2 blocks/);
    const { threads } = json(await send(`/cr/${cr.slug}/api/threads?path=${NOTE}`)) as { threads: Thread[] };
    expect(threads).toEqual([expect.objectContaining({ severity: 'nit', state: 'open', anchor: expect.objectContaining({ index: 1, text: expect.stringContaining('A first look') as string }) as unknown })]);
  });

  it('moves a thread from the page, for every open client, and refuses that on main', async () => {
    const added = await call(client, 'add_comment', { cr: cr.slug, path: NOTE, body: 'Resolve me.' });
    const { id } = added.value as { id: string };
    const controller = new AbortController();
    const response = await fetch(`${studio.origin}/cr/${cr.slug}/api/proposals/events`, { signal: controller.signal });
    const reader = (response.body ?? new ReadableStream()).pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    while (!buffer.includes('retry:')) buffer += (await reader.read()).value ?? '';
    expect((await send(`/cr/${cr.slug}/api/threads/${id}/state`, 'POST', { state: 'resolved' })).status).toBe(200);
    while (!buffer.includes('event: thread')) buffer += (await reader.read()).value ?? '';
    controller.abort();
    expect(buffer).toContain('"state":"resolved"');
    expect((await send(`/cr/${cr.slug}/api/threads/${id}`)).status).toBe(200);
    // Main is read only: its writes are refused before any route.
    expect((await send(`/api/threads/${id}/state`, 'POST', { state: 'open' })).status).toBe(403);
  });

  it('gives an agent run the tools over stdio or HTTP, held to its change request', async () => {
    for (const agent of ['claude', 'codex']) {
      const run = await runAgent(`mcp-servers\nmcp read_note {"path": "${NOTE}"}\nmcp read_note {"cr": "from-a-terminal", "path": "${NOTE}"}\nmcp list_crs {}`, 'author', agent);
      expect(run.said).toContain(agent === 'codex' ? '"type":"http"' : '"command"');
      expect(run.said).toContain(`mcp:{\n  "path": "${NOTE}"`);
      expect(run.said).toContain(`mcp-error:this agent works in the change request ${cr.slug} only`);
      expect(run.said).toMatch(/mcp-error:list_crs is for a person's agent/);
    }
  }, 40_000);

  it('records an author run as the proposal\'s author, and refuses a reviewer', async () => {
    const author = await runAgent(`mcp propose_edit {"path": "${NOTE}", "edits": [{"find": "tightened", "replace": "sharpened"}]}`);
    expect(author.said).toMatch(/^mcp:/);
    const { proposals } = json(await send(`/cr/${cr.slug}/api/proposals`)) as { proposals: ProposalView[] };
    expect(proposals.at(-1)?.by).toEqual({ kind: 'run', runId: author.run.id, agent: 'claude', model: 'Fake One' });
    const reviewer = await runAgent(`mcp propose_edit {"path": "${NOTE}", "content": "x"}\nmcp add_comment {"path": "${NOTE}", "body": "Fine."}`, 'reviewer');
    expect(reviewer.said).toContain('mcp-error:propose_edit is for an author');
    expect(reviewer.said).toContain('mcp:{');
  }, 30_000);

  it('lets a chat\'s token act only during its turns, and ends it with the agent process', async () => {
    const run = await runAgent('mcp-servers', 'author', 'codex');
    const token = /"value":"Bearer ([^"]+)"/.exec(run.said)?.[1] ?? '';
    expect(token).not.toBe('');
    const list = () => sender(studio.origin)('/api/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
    // Between turns the process keeps its token, but it acts for nothing.
    expect((await list()).status).toBe(401);
    // The next turn uses it again.
    const next = await send(`/cr/${cr.slug}/api/agents/conversations/${run.run.id}/messages`, 'POST', { prompt: 'mcp list_notes {"cr": "' + cr.slug + '"}' });
    expect(next.status).toBe(200);
    for (const deadline = Date.now() + 10_000; Date.now() < deadline;) {
      const read = json(await send(`/cr/${cr.slug}/api/agents/conversations/${run.run.id}`)) as { conversation: Conversation; events: Parameters<typeof messagesOf>[0] };
      if (read.conversation.status !== 'running') {
        expect(messagesOf(read.events).join('\n')).toMatch(/^mcp:/m);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Deleting the chat stops the process and drops the token.
    expect((await send(`/cr/${cr.slug}/api/agents/conversations/${run.run.id}`, 'DELETE')).status).toBe(200);
    expect((await list()).status).toBe(401);
  }, 20_000);

  it('puts a tool\'s write through ctx.files on the run\'s Keep/Revert list', async () => {
    const meta = 'content/docs/guide/meta.yaml';
    const before = await readFile(worktree(meta), 'utf8');
    const run = await runAgent(`mcp test_write {"path": "${meta}", "content": "title: By a tool\\n"}\nmcp test_write {"path": "../outside.txt", "content": "x"}`);
    expect(run.said).toMatch(/^mcp:\d/);
    expect(run.said).toContain('mcp-error:not an editable path: ../outside.txt');
    expect(run.run.writes).toContain(meta);
    expect(json(await send(`/cr/${cr.slug}/api/agents/conversations/${run.run.id}/turns/1/changes/before?path=${meta}`))).toEqual({ path: meta, content: before });
    expect((await send(`/cr/${cr.slug}/api/agents/conversations/${run.run.id}/turns/1/changes`, 'POST', { path: meta, op: 'revert' })).status).toBe(200);
    expect(await readFile(worktree(meta), 'utf8')).toBe(before);
  }, 20_000);

  it('reverts to the file as the run found it, even after a commit during the run', async () => {
    const page = 'content/docs/index.mdx';
    const before = await readFile(worktree(page), 'utf8');
    const { conversation: run } = json(await send(`/cr/${cr.slug}/api/agents/conversations`, 'POST', { agent: 'claude', role: 'author', prompt: `edit ${worktree(page)} by the agent\nhang` })) as { conversation: Conversation };
    const deadline = Date.now() + 10_000;
    while ((await readFile(worktree(page), 'utf8')) === before && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    await git(cr.worktree ?? '', 'commit', '--quiet', '-am', 'during the run');
    await send(`/cr/${cr.slug}/api/agents/conversations/${run.id}/cancel`, 'POST', {});
    for (;;) {
      const read = json(await send(`/cr/${cr.slug}/api/agents/conversations/${run.id}`)) as { conversation: Conversation };
      if (read.conversation.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(json(await send(`/cr/${cr.slug}/api/agents/conversations/${run.id}/turns/1/changes/before?path=${page}`))).toEqual({ path: page, content: before });
  }, 20_000);

  // A note committed as `content`, so the run finds it clean.
  async function committed(path: string, content: string) {
    await writeFile(worktree(path), content);
    await git(cr.worktree ?? '', 'add', '--', path);
    await git(cr.worktree ?? '', 'commit', '--quiet', '-m', `add ${path}`);
  }

  // Starts a run that ends with `hang`, does `during` while it waits, then
  // cancels it and waits for its end.
  async function hangingRun(prompt: string, during: () => Promise<void>) {
    const { conversation: run } = json(await send(`/cr/${cr.slug}/api/agents/conversations`, 'POST', { agent: 'claude', role: 'author', prompt: `${prompt}\nhang` })) as { conversation: Conversation };
    await during();
    await send(`/cr/${cr.slug}/api/agents/conversations/${run.id}/cancel`, 'POST', {});
    for (;;) {
      const read = json(await send(`/cr/${cr.slug}/api/agents/conversations/${run.id}`)) as { conversation: Conversation };
      if (read.conversation.status !== 'running') return read.conversation;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  const changed = async (path: string, from: string) => {
    const deadline = Date.now() + 10_000;
    while ((await readFile(worktree(path), 'utf8').catch(() => from)) === from &&Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  };

  it('lists a file the agent changed with its own tool and committed during the run', async () => {
    const page = 'content/docs/guide/committed.mdx';
    await committed(page, 'As found.\n');
    const run = await hangingRun(`sneak ${worktree(page)} by the agent`, async () => {
      await changed(page, 'As found.\n');
      await git(cr.worktree ?? '', 'commit', '--quiet', '-am', 'the agent commits');
    });
    expect(run.writes).toContain(page);
    const base = `/cr/${cr.slug}/api/agents/conversations/${run.id}/turns/1/changes`;
    expect(json(await send(`${base}/before?path=${page}`))).toEqual({ path: page, content: 'As found.\n' });
    expect((await send(base, 'POST', { path: page, op: 'revert' })).status).toBe(200);
    expect(await readFile(worktree(page), 'utf8')).toBe('As found.\n');
  }, 20_000);

  it('keeps the file as the run found it, not as the agent left it before a later write', async () => {
    // An asset: a write to a note that exists would be a proposal.
    const page = 'public/docs/guide/twice.svg';
    await mkdir(dirname(worktree(page)), { recursive: true });
    await committed(page, 'As found.\n');
    const run = await runAgent(`sneak ${worktree(page)} first\nwrite ${worktree(page)} second`);
    expect(await readFile(worktree(page), 'utf8')).toBe('second');
    const base = `/cr/${cr.slug}/api/agents/conversations/${run.run.id}/turns/1/changes`;
    expect(json(await send(`${base}/before?path=${page}`))).toEqual({ path: page, content: 'As found.\n' });
    expect((await send(base, 'POST', { path: page, op: 'revert' })).status).toBe(200);
    expect(await readFile(worktree(page), 'utf8')).toBe('As found.\n');
  }, 20_000);

  it('never reverts a person\'s save made during the run', async () => {
    const page = 'content/docs/guide/saved.mdx';
    await committed(page, 'As found.\n');
    // The agent's first edit shows the run has started.
    const marker = 'content/docs/guide/marker.mdx';
    const run = await hangingRun(`sneak ${worktree(marker)} started`, async () => {
      await changed(marker, '');
      const { mtimeMs } = json(await send(`/cr/${cr.slug}/api/file?path=${page}`)) as { mtimeMs: number };
      expect((await send(`/cr/${cr.slug}/api/file?path=${page}`, 'PUT', { content: 'By a person.\n', baseMtime: mtimeMs })).status).toBe(200);
    });
    const base = `/cr/${cr.slug}/api/agents/conversations/${run.id}/turns/1/changes`;
    const { changes } = json(await send(base)) as { changes: TurnChange[] };
    expect(changes).toContainEqual({ path: page, existed: true, decided: null, reason: 'also saved by a person during the turn: revert it by hand' });
    expect(json(await send(`${base}/before?path=${page}`))).toEqual({ path: page, content: 'As found.\n' });
    expect((await send(base, 'POST', { path: page, op: 'revert' })).status).toBe(409);
    expect(await readFile(worktree(page), 'utf8')).toBe('By a person.\n');
    await rm(worktree(marker));
  }, 20_000);

  // The editor saves through the notes sync, not the file API.
  it('never reverts a note a person saved in the editor during the run', async () => {
    const page = 'content/docs/guide/typed.mdx';
    await committed(page, 'As found.\n');
    const marker = 'content/docs/guide/marker.mdx';
    const sync = syncWith(studio.origin, '', `/cr/${cr.slug}`);
    try {
      const run = await hangingRun(`sneak ${worktree(marker)} started`, async () => {
        await changed(marker, '');
        const editor = new TextEditor();
        const doc = sync.open('guide/typed.mdx', { editor });
        editor.text = `${(await doc.opened).text}Typed by a person.\n`;
        doc.changed();
        await doc.flush();
        await changed(page, 'As found.\n');
      });
      const base = `/cr/${cr.slug}/api/agents/conversations/${run.id}/turns/1/changes`;
      const { changes } = json(await send(base)) as { changes: TurnChange[] };
      expect(changes).toContainEqual({ path: page, existed: true, decided: null, reason: 'also saved by a person during the turn: revert it by hand' });
      expect((await send(base, 'POST', { path: page, op: 'revert' })).status).toBe(409);
      expect(await readFile(worktree(page), 'utf8')).toBe('As found.\nTyped by a person.\n');
    } finally {
      sync.close();
      await rm(worktree(marker));
    }
  }, 20_000);

  it('answers no such tool for a name only inherited', async () => {
    for (const name of ['constructor', 'toString', '__proto__']) {
      expect(await call(client, name, {})).toMatchObject({ error: true, text: expect.stringContaining(`no such tool: ${name}`) as unknown });
    }
  });

  it('takes a run\'s edits to the note it created as proposals once someone else changed it', async () => {
    // Saved through the file API, then changed on disk some other way (as
    // the live editor's sync does): either way the note is no longer only
    // the run's draft, and its later edits are proposed.
    const saved = 'content/docs/guide/drafted.mdx';
    const synced = 'content/docs/guide/drafted-too.mdx';
    const go = (name: string) => join(cr.worktree ?? '', '..', `${cr.slug}-${name}-${String(Date.now())}`);
    const [first, second] = [go('first'), go('second')];
    const proposalsOf = async (path: string) => (json(await send(`/cr/${cr.slug}/api/proposals?path=${path}`)) as { proposals: ProposalView[] }).proposals;
    const until = async (check: () => Promise<boolean>) => {
      const deadline = Date.now() + 10_000;
      while (!(await check()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    };
    await hangingRun([
      `write ${worktree(saved)} Draft.`,
      `mcp propose_edit {"path": "${synced}", "content": "Draft.\\n"}`,
      `wait ${first}`,
      `write ${worktree(saved)} Second draft.`,
      `wait ${second}`,
      `mcp propose_edit {"path": "${synced}", "edits": [{"find": "Draft.", "replace": "Fixed."}]}`,
    ].join('\n'), async () => {
      await changed(synced, '');
      const { mtimeMs } = json(await send(`/cr/${cr.slug}/api/file?path=${saved}`)) as { mtimeMs: number };
      expect((await send(`/cr/${cr.slug}/api/file?path=${saved}`, 'PUT', { content: 'By a person.\n', baseMtime: mtimeMs })).status).toBe(200);
      await writeFile(first, '');
      await until(async () => (await proposalsOf(saved)).length > 0);
      await writeFile(worktree(synced), 'Draft.\n\nBy the editor.\n');
      await writeFile(second, '');
      await until(async () => (await proposalsOf(synced)).length > 0);
    });
    await Promise.all([rm(first, { force: true }), rm(second, { force: true })]);
    expect(await readFile(worktree(saved), 'utf8')).toBe('By a person.\n');
    expect((await proposalsOf(saved)).flatMap((proposal) => proposal.hunks.map((hunk) => hunk.added)).join('')).toContain('Second draft.');
    expect(await readFile(worktree(synced), 'utf8')).toBe('Draft.\n\nBy the editor.\n');
    expect((await proposalsOf(synced)).flatMap((proposal) => proposal.hunks.map((hunk) => hunk.added)).join('')).toContain('Fixed.');
  }, 30_000);

  it('lists what a run changed with its own tools, to keep or revert', async () => {
    const meta = 'content/docs/guide/meta.yaml';
    const metaBefore = await readFile(worktree(meta), 'utf8');
    const noteBefore = await readFile(worktree(NOTE), 'utf8');
    const added = 'content/docs/guide/new.mdx';
    const run = await runAgent(`sneak ${worktree(NOTE)} rewritten\nwrite ${worktree(meta)} title: Changed\nsneak ${worktree(added)} new`);
    const base = `/cr/${cr.slug}/api/agents/conversations/${run.run.id}/turns/1/changes`;
    const { changes } = json(await send(base)) as { changes: TurnChange[] };
    expect(changes).toEqual(expect.arrayContaining([
      { path: NOTE, existed: true, decided: null, reason: null },
      { path: meta, existed: true, decided: null, reason: null },
      { path: added, existed: false, decided: null, reason: null },
    ]));
    expect(json(await send(`${base}/before?path=${meta}`))).toEqual({ path: meta, content: metaBefore });

    expect(json(await send(base, 'POST', { path: meta, op: 'revert' }))).toMatchObject({ change: { decided: 'reverted' } });
    expect(await readFile(worktree(meta), 'utf8')).toBe(metaBefore);
    expect((await send(base, 'POST', { path: meta, op: 'revert' })).status).toBe(409);

    expect((await send(base, 'POST', { path: added, op: 'revert' })).status).toBe(200);
    await expect(readFile(worktree(added), 'utf8')).rejects.toThrow();

    // Changed again after the run: never reverted over.
    await writeFile(worktree(NOTE), 'by a person');
    expect((await send(base, 'POST', { path: NOTE, op: 'revert' })).status).toBe(409);
    expect(json(await send(base, 'POST', { path: NOTE, op: 'keep' }))).toMatchObject({ change: { decided: 'kept' } });
    await writeFile(worktree(NOTE), noteBefore);
  }, 20_000);
});

describe('Studio MCP server with sign-in', () => {
  let repo: GitRepo;
  let studio: CrStudio;
  let faked: ReturnType<typeof fakeAuth>;
  let slug: string;

  beforeAll(async () => {
    repo = await makeGitRepo();
    faked = fakeAuth(repo.home);
    faked.gh.addUser('writer', 'write');
    faked.gh.addUser('reader', 'read');
    studio = await startCrStudio(repo, { auth: faked.auth });
    const send = sender(studio.origin);
    const writer = await signInWith(send, faked.gh, 'writer');
    slug = (json(await send('/api/crs', { method: 'POST', body: { name: 'Signed in' }, cookie: writer.cookie, csrf: writer.csrf })) as { cr: ChangeRequest }).cr.slug;
  }, 30_000);

  afterAll(async () => {
    await studio.close();
    await faked.auth.sessions.saved();
    await repo.remove();
  });

  it('refuses a request without a token, or with one that is not a Studio token', async () => {
    await expect(connect(studio.origin)).rejects.toThrow();
    await expect(connect(studio.origin, 'studio-agent-nope')).rejects.toThrow();
  });

  it('acts for the person whose token it is, with their role, until they clear it', async () => {
    const send = sender(studio.origin);
    const writer = await signInWith(send, faked.gh, 'writer');
    const reader = await signInWith(send, faked.gh, 'reader');
    expect((await send('/api/mcp/tokens', { method: 'POST', body: {}, cookie: writer.cookie })).status).toBe(403);
    const readerToken = (json(await send('/api/mcp/tokens', { method: 'POST', body: {}, cookie: reader.cookie, csrf: reader.csrf })) as { token: string }).token;
    const reading = await connect(studio.origin, readerToken);
    expect((await reading.listTools()).tools.map((tool) => tool.name)).not.toContain('propose_edit');
    expect((await call(reading, 'read_note', { cr: slug, path: NOTE })).error).toBe(false);
    expect((await call(reading, 'propose_edit', { cr: slug, path: NOTE, content: 'x' })).text).toMatch(/needs write access/);
    expect((await call(reading, 'add_comment', { cr: slug, path: NOTE, body: 'x' })).text).toMatch(/needs write access/);
    await reading.close();
    const { token } = json(await send('/api/mcp/tokens', { method: 'POST', body: {}, cookie: writer.cookie, csrf: writer.csrf })) as { token: string };

    const client = await connect(studio.origin, token);
    const proposed = await call(client, 'propose_edit', { cr: slug, path: NOTE, content: '---\ntitle: First look\n---\n\nA first look, by writer.\n' });
    expect(proposed.error).toBe(false);
    const { proposals } = json(await send(`/cr/${slug}/api/proposals`, { cookie: writer.cookie })) as { proposals: ProposalView[] };
    expect(proposals[0]?.by).toEqual({ kind: 'person', login: 'writer' });
    await client.close();
  });

  it('ends agent tokens when the person clears them or signs out', async () => {
    const send = sender(studio.origin);
    const writer = await signInWith(send, faked.gh, 'writer');
    const mint = async () => (json(await send('/api/mcp/tokens', { method: 'POST', body: {}, cookie: writer.cookie, csrf: writer.csrf })) as { token: string }).token;
    const first = await mint();
    await (await connect(studio.origin, first)).close();
    expect((await send('/api/mcp/tokens', { method: 'DELETE', cookie: writer.cookie, csrf: writer.csrf })).status).toBe(200);
    await expect(connect(studio.origin, first)).rejects.toThrow();
    const second = await mint();
    await send('/api/session/logout', { method: 'POST', body: {}, cookie: writer.cookie, csrf: writer.csrf });
    await expect(connect(studio.origin, second)).rejects.toThrow();
  });
});
