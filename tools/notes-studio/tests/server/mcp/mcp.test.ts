import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { git } from '../../../server/cr/git';
import type { StudioTool } from '../../../server/mcp/tool';
import type { RunChange, RunSummary } from '../../../server/agents/shared';
import type { ChangeRequest } from '../../../server/cr/manager';
import type { NoteComment } from '../../../server/proposals/comments';
import type { ProposalView } from '../../../server/proposals/shared';
import { fakeProfile, messagesOf } from '../../support/agents';
import { fakeAuth, sender, signInWith } from '../../support/auth';
import { makeGitRepo, startCrStudio, type CrStudio, type GitRepo } from '../../support/git-repo';
import { json } from '../../support/http';

const NOTE = 'content/notes/guide/first-look.mdx';

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

  // Starts a run of the fake agent and waits for its end.
  async function runAgent(prompt: string, role = 'author', agent = 'claude') {
    const { run } = json(await send(`/cr/${cr.slug}/api/agents/runs`, 'POST', { agent, role, prompt })) as { run: RunSummary };
    const deadline = Date.now() + 15_000;
    for (;;) {
      const read = json(await send(`/cr/${cr.slug}/api/agents/runs/${run.id}`)) as { run: RunSummary; events: Parameters<typeof messagesOf>[0] };
      if (read.run.status !== 'running') return { ...read, said: messagesOf(read.events).join('\n') };
      if (Date.now() > deadline) throw new Error('the run did not end');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  beforeAll(async () => {
    repo = await makeGitRepo();
    studio = await startCrStudio(repo, { agents: [fakeProfile(), fakeProfile({ FAKE_MCP: 'http' }, 'codex')], tools: [WRITE_TOOL] });
    cr = (json(await send('/api/crs', 'POST', { name: 'Agent tools' })) as { cr: ChangeRequest }).cr;
    await writeFile(worktree('content/notes/guide/index.mdx'), '---\ntitle: Guide\ntags: [intro]\n---\n\nThe guide. See [first look](./first-look.mdx).\n');
    client = await connect(studio.origin);
  }, 30_000);

  afterAll(async () => {
    await client.close();
    await studio.close();
    await repo.remove();
  });

  it('lists the change request tools and the note tools, each note tool taking cr', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).filter((name) => !name.startsWith('diagram_')).sort()).toEqual(['add_comment', 'create_cr', 'list_assets', 'list_crs', 'list_notes', 'note_graph', 'propose_edit', 'read_note', 'search_notes', 'test_write']);
    expect(tools.filter((tool) => tool.name.startsWith('diagram_'))).toHaveLength(11);
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
    expect((await call(client, 'read_note', { cr: cr.slug, path: 'content/notes/.secret.mdx' })).text).toMatch(/not an editable path/);
    expect((await call(client, 'read_note', { cr: cr.slug, path: 'content/notes/missing.mdx' })).text).toMatch(/no such note/);
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
    expect((found.value?.results as { path: string }[]).map((result) => result.path)).toEqual(expect.arrayContaining([NOTE, 'content/notes/guide/index.mdx']));
    const graph = await call(client, 'note_graph', { cr: cr.slug, path: NOTE });
    expect(graph.value).toMatchObject({ linksTo: [], linkedFrom: ['content/notes/guide/index.mdx'] });
    const index = await call(client, 'note_graph', { cr: cr.slug, path: 'content/notes/guide/index.mdx' });
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

  it('keeps comments, anchored to a block', async () => {
    const added = await call(client, 'add_comment', { cr: cr.slug, path: NOTE, block: 1, body: 'Say more here.' });
    expect(added.error).toBe(false);
    expect((await call(client, 'add_comment', { cr: cr.slug, path: NOTE, block: 9, body: 'x' })).text).toMatch(/has 2 blocks/);
    const { comments } = json(await send(`/cr/${cr.slug}/api/comments?path=${NOTE}`)) as { comments: NoteComment[] };
    expect(comments).toEqual([expect.objectContaining({ body: 'Say more here.', block: { index: 1, text: expect.stringContaining('A first look') as string } })]);
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

  it('ends a run\'s token with the run', async () => {
    const run = await runAgent('mcp-servers', 'author', 'codex');
    const token = /"value":"Bearer ([^"]+)"/.exec(run.said)?.[1] ?? '';
    expect(token).not.toBe('');
    const response = await sender(studio.origin)('/api/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
    expect(response.status).toBe(401);
  }, 20_000);

  it('puts a tool\'s write through ctx.files on the run\'s Keep/Revert list', async () => {
    const meta = 'content/notes/guide/meta.yaml';
    const before = await readFile(worktree(meta), 'utf8');
    const run = await runAgent(`mcp test_write {"path": "${meta}", "content": "title: By a tool\\n"}\nmcp test_write {"path": "../outside.txt", "content": "x"}`);
    expect(run.said).toMatch(/^mcp:\d/);
    expect(run.said).toContain('mcp-error:not an editable path: ../outside.txt');
    expect(run.run.writes).toContain(meta);
    expect(json(await send(`/cr/${cr.slug}/api/agents/runs/${run.run.id}/changes/before?path=${meta}`))).toEqual({ path: meta, content: before });
    expect((await send(`/cr/${cr.slug}/api/agents/runs/${run.run.id}/changes`, 'POST', { path: meta, op: 'revert' })).status).toBe(200);
    expect(await readFile(worktree(meta), 'utf8')).toBe(before);
  }, 20_000);

  it('reverts to the file as the run found it, even after a commit during the run', async () => {
    const page = 'content/notes/index.mdx';
    const before = await readFile(worktree(page), 'utf8');
    const { run } = json(await send(`/cr/${cr.slug}/api/agents/runs`, 'POST', { agent: 'claude', role: 'author', prompt: `edit ${worktree(page)} by the agent\nhang` })) as { run: RunSummary };
    const deadline = Date.now() + 10_000;
    while ((await readFile(worktree(page), 'utf8')) === before && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    await git(cr.worktree ?? '', 'commit', '--quiet', '-am', 'during the run');
    await send(`/cr/${cr.slug}/api/agents/runs/${run.id}/cancel`, 'POST', {});
    for (;;) {
      const read = json(await send(`/cr/${cr.slug}/api/agents/runs/${run.id}`)) as { run: RunSummary };
      if (read.run.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(json(await send(`/cr/${cr.slug}/api/agents/runs/${run.id}/changes/before?path=${page}`))).toEqual({ path: page, content: before });
  }, 20_000);

  it('lists what a run changed with its own tools, to keep or revert', async () => {
    const meta = 'content/notes/guide/meta.yaml';
    const metaBefore = await readFile(worktree(meta), 'utf8');
    const noteBefore = await readFile(worktree(NOTE), 'utf8');
    const added = 'content/notes/guide/new.mdx';
    const run = await runAgent(`sneak ${worktree(NOTE)} rewritten\nwrite ${worktree(meta)} title: Changed\nsneak ${worktree(added)} new`);
    const base = `/cr/${cr.slug}/api/agents/runs/${run.run.id}/changes`;
    const { changes } = json(await send(base)) as { changes: RunChange[] };
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
