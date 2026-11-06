import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createAgentConversations, type AgentConversations } from '#agents/conversations.ts';
import { createTranscripts } from '#agents/transcripts.ts';
import type { ConversationEvent } from '@fdbook/shared/agents.ts';
import { ended, fakeProfile, messagesOf, waitFor } from '#tests/support/agents.ts';
import { makeGitWorktree } from '@fdbook/testing/git.ts';
import type { Worktree } from '@fdbook/testing/studio.ts';

const NOTE = 'content/docs/agent-note.mdx';

describe('agent conversations', () => {
  let worktree: Worktree;
  let root: string;
  let home: string;
  let runs: AgentConversations;
  const open: AgentConversations[] = [];

  const make = (env: Record<string, string> = {}, options: { permissionTimeoutMs?: number } = {}, fencesReviewer = true) => {
    const made = createAgentConversations(root, { slug: 'fix-typo', profiles: [fakeProfile(env, 'claude', fencesReviewer)], transcripts: createTranscripts(home), ...options });
    open.push(made);
    return made;
  };
  const startRun = (prompt: string, role = 'author', on = runs) => on.start({ agent: 'claude', role, prompt, by: 'octocat' });

  beforeAll(async () => {
    worktree = await makeGitWorktree();
    root = await realpath(worktree.root);
    home = await mkdtemp(join(tmpdir(), 'notes-studio-agents-'));
    await writeFile(join(root, NOTE), '---\ntitle: Agent\n---\n\nBefore.\n');
  });

  afterEach(async () => {
    await Promise.all(open.splice(0).map((made) => made.close()));
    runs = make();
  });

  afterAll(async () => {
    await Promise.all(open.splice(0).map((made) => made.close()));
    await worktree.remove();
    await rm(home, { recursive: true, force: true });
  });

  beforeAll(() => {
    runs = make();
  });

  it('answers a first message and keeps the model, the cost and the usage', async () => {
    const run = startRun(`read ${join(root, NOTE)}`);
    expect(run.status).toBe('running');
    const done = await waitFor(runs, run.id, ended);
    expect(done.conversation).toMatchObject({ status: 'done', model: 'Fake One', cost: { amount: 0.12, currency: 'USD' }, usage: { totalTokens: 30 }, by: 'octocat', role: 'author' });
    expect(messagesOf(done.events)).toEqual(['read:---\ntitle: Agent\n---\n\nBefore.\n']);
  });

  it('writes a note through the Studio for an author, and records it', async () => {
    const run = startRun(`write ${join(root, NOTE)} After.`);
    const done = await waitFor(runs, run.id, ended);
    expect(messagesOf(done.events)).toEqual(['wrote']);
    expect(await readFile(join(root, NOTE), 'utf8')).toBe('After.');
    expect(done.conversation.writes).toEqual([NOTE]);
    expect(done.events.filter((event) => event.type === 'write')).toMatchObject([{ path: NOTE, bytes: 6 }]);
  });

  it('records the files the agent changes with its own tools, reported or not', async () => {
    const reported = join(root, 'content/docs/reported.mdx');
    const quiet = join(root, 'server-side.ts');
    const done = await waitFor(runs, startRun(`edit ${reported} By its tool.\nsneak ${quiet} export {};`).id, ended);
    expect(done.events.filter((event) => event.type === 'changed')).toMatchObject([{ paths: ['content/docs/reported.mdx'] }, { paths: ['server-side.ts'] }]);
    expect(done.conversation.writes).toEqual(['content/docs/reported.mdx', 'server-side.ts']);
    await rm(reported);
    await rm(quiet);
  });

  it('says no for any reviewer asking for more than reading, fenced agent or not', async () => {
    for (const fenced of [true, false]) {
      const reviewing = make({}, {}, fenced);
      const done = await waitFor(reviewing, startRun('ask-edit\nask', 'reviewer', reviewing).id, ended);
      expect(done.events.filter((event) => event.type === 'answer')).toMatchObject([{ optionId: null, by: 'studio' }, { optionId: null, by: 'studio' }]);
      expect(messagesOf(done.events)).toEqual(['answer:cancelled', 'answer:cancelled']);
    }
  });

  it('starts the session in the profile\'s mode, whatever the agent defaults to', async () => {
    const asking = createAgentConversations(root, { slug: 'fix-typo', profiles: [fakeProfile({}, 'claude', true, 'default')], transcripts: createTranscripts(home) });
    open.push(asking);
    expect(messagesOf((await waitFor(asking, startRun('mode', 'author', asking).id, ended)).events)).toEqual(['mode:default']);
    expect(messagesOf((await waitFor(runs, startRun('mode').id, ended)).events)).toEqual(['mode:acceptEdits']);
  });

  it('lets a reviewer read but not write', async () => {
    await writeFile(join(root, NOTE), 'Kept.');
    const run = startRun(`write ${join(root, NOTE)} Changed.`, 'reviewer');
    const done = await waitFor(runs, run.id, ended);
    expect(messagesOf(done.events)[0]).toMatch(/^refused:.*reviewer reads only/);
    expect(await readFile(join(root, NOTE), 'utf8')).toBe('Kept.');
  });

  it('refuses reads and writes outside what the Studio allows', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'notes-studio-outside-'));
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(join(outside, 'secret.txt'), join(root, 'content/docs/link.mdx'));
    await writeFile(join(root, '.env'), 'TOKEN=1');
    const prompt = [
      `read ${join(outside, 'secret.txt')}`,
      `read ${join(root, 'content/docs/link.mdx')}`,
      `read ${join(root, '.env')}`,
      `read ${join(root, '.git/config')}`,
      `read ${root}/content/docs/../../../etc/passwd`,
      `write ${join(root, 'package.json')} {}`,
      `write ${join(root, 'content/docs/link.mdx')} replaced`,
      `write ${join(outside, 'new.mdx')} x`,
      `read ${join(root, 'package.json')}`,
    ].join('\n');
    const done = await waitFor(runs, startRun(prompt).id, ended);
    // The agent's messages in a row join into one text.
    const said = messagesOf(done.events).join('').split(/(?=refused:|read:)/);
    expect(said.slice(0, 8).every((message) => message.startsWith('refused:'))).toBe(true);
    // A repo file outside the editable areas can still be read.
    expect(said[8]).toBe('read:{}\n');
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('secret');
    await rm(join(root, 'content/docs/link.mdx'));
    await rm(join(root, '.env'));
    await rm(outside, { recursive: true, force: true });
  });

  it('asks for permission without the options that outlive the conversation, and passes the answer on', async () => {
    const run = startRun('ask');
    const asked = await waitFor(runs, run.id, ({ events }) => events.some((event) => event.type === 'permission'));
    const permission = asked.events.find((event): event is Extract<ConversationEvent, { type: 'permission' }> => event.type === 'permission');
    expect(permission?.ask.options.map((option) => option.optionId)).toEqual(['once', 'no']);
    expect(() => { runs.answer(run.id, permission?.ask.id ?? '', 'always', 'octocat'); }).toThrow(/one of the options/);
    runs.answer(run.id, permission?.ask.id ?? '', 'once', 'octocat');
    const done = await waitFor(runs, run.id, ended);
    expect(messagesOf(done.events)).toEqual(['answer:once']);
    expect(done.events.find((event) => event.type === 'answer')).toMatchObject({ optionId: 'once', by: 'octocat' });
    expect(() => { runs.answer(run.id, permission?.ask.id ?? '', 'once', null); }).toThrow(/no turn is going on/);
  });

  it('rejects a question nobody answers in time', async () => {
    const quick = make({}, { permissionTimeoutMs: 100 });
    const run = startRun('ask', 'author', quick);
    const done = await waitFor(quick, run.id, ended);
    expect(messagesOf(done.events)).toEqual(['answer:cancelled']);
    expect(done.events.find((event) => event.type === 'answer')).toMatchObject({ optionId: null, by: null });
  });

  it('cancels a turn, answering its open question', async () => {
    const run = startRun('ask\nhang');
    await waitFor(runs, run.id, ({ events }) => events.some((event) => event.type === 'permission'));
    runs.cancel(run.id);
    const done = await waitFor(runs, run.id, ended);
    expect(done.conversation.status).toBe('cancelled');
    expect(messagesOf(done.events)).toEqual(['answer:cancelled']);
  });

  it('stops an agent that ignores the cancel when the change request closes', async () => {
    const closing = make();
    const run = startRun('deaf', 'author', closing);
    await waitFor(closing, run.id, ({ conversation: summary }) => summary.model !== null);
    const started = Date.now();
    await closing.close();
    expect(Date.now() - started).toBeLessThan(5000);
    expect((await closing.read(run.id)).conversation.status).toBe('cancelled');
    expect(() => startRun('read x', 'author', closing)).toThrow(/closing/);
  });

  it('reports an agent that crashes, with what it printed', async () => {
    const done = await waitFor(runs, startRun('crash').id, ended);
    expect(done.conversation.status).toBe('failed');
    expect(done.conversation.error).toMatch(/Fake Agent stopped \(exit 3\): boom: the fake agent crashed/);
  });

  it('fails a turn at once when its agent cannot be started, freeing its place', async () => {
    const broken = createAgentConversations(root, {
      slug: 'fix-typo',
      profiles: [{ ...fakeProfile(), command: () => { throw new Error('@agentclientprotocol/claude-agent-acp has no claude-agent-acp command'); } }],
      transcripts: createTranscripts(home),
    });
    open.push(broken);
    const run = startRun('env', 'author', broken);
    expect(run).toMatchObject({ status: 'failed', error: '@agentclientprotocol/claude-agent-acp has no claude-agent-acp command' });
    for (let index = 0; index < 3; index += 1) expect(startRun('env', 'author', broken).status).toBe('failed');
    expect((await broken.read(run.id)).conversation.status).toBe('failed');
  });

  it('says when the agent is not signed in', async () => {
    const unsigned = make({ FAKE_AGENT: 'auth' });
    const done = await waitFor(unsigned, startRun('read x', 'author', unsigned).id, ended);
    expect(done.conversation).toMatchObject({ status: 'failed', error: 'Fake Agent is not signed in: sign in once in a terminal, then send again' });
  });

  it('starts the agent in the worktree without the Studio\'s GitHub secrets', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, { STUDIO_SECRET: 'x', GH_TOKEN: 'x', GITHUB_TOKEN: 'x' });
    try {
      const done = await waitFor(runs, startRun('env').id, ended);
      expect(messagesOf(done.events)).toEqual([`env: cwd:${root}`]);
    } finally {
      process.env = saved;
    }
  });

  it('keeps transcripts on disk, last active first, and reads a turn left running as failed', async () => {
    const first = await waitFor(runs, startRun('env').id, ended);
    const second = await waitFor(runs, startRun('env').id, ended);
    await runs.close();
    const again = make();
    const listed = await again.list();
    expect(listed.slice(0, 2).map((run) => run.id)).toEqual([second.conversation.id, first.conversation.id]);
    // On disk too, and then the process stopping with the change request.
    const stored = (await again.read(first.conversation.id)).events.map((event) => event.type);
    expect(stored).toEqual([...first.events.map((event) => event.type), 'summary']);
    expect((await again.read(first.conversation.id)).conversation.live).toBe(false);

    const transcripts = createTranscripts(home);
    const stale = { ...first.conversation, id: 'zz-stale', status: 'running' as const, startedMs: Date.now() + 1000, lastMs: Date.now() + 1000 };
    transcripts.append('fix-typo', stale.id, { type: 'start', at: stale.startedMs, conversation: stale });
    await transcripts.settled();
    expect((await again.list())[0]).toMatchObject({ id: 'zz-stale', status: 'failed', error: 'the Studio stopped during the turn', live: false });
    await expect(again.read('missing')).rejects.toThrow(/no such conversation/);
  });

  it('refuses a bad request, and a fourth conversation while three are in a turn', () => {
    expect(() => runs.start({ agent: 'nobody', role: 'author', prompt: 'x', by: null })).toThrow(/agent must be/);
    expect(() => runs.start({ agent: 'claude', role: 'owner', prompt: 'x', by: null })).toThrow(/role must be/);
    expect(() => runs.start({ agent: 'claude', role: 'author', prompt: '  ', by: null })).toThrow(/prompt must be/);
    for (let index = 0; index < 3; index += 1) startRun('hang');
    expect(() => startRun('hang')).toThrow(/3 agents are already working here/);
  });
});
