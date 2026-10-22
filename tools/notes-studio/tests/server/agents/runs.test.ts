import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createAgentRuns, type AgentRuns } from '../../../server/agents/runs';
import { createTranscripts } from '../../../server/agents/transcripts';
import type { RunEvent } from '../../../server/agents/shared';
import { ended, fakeProfile, messagesOf, waitForRun } from '../../support/agents';
import { makeGitWorktree } from '../../support/git';
import type { Worktree } from '../../support/studio';

const NOTE = 'content/notes/agent-note.mdx';

describe('agent runs', () => {
  let worktree: Worktree;
  let root: string;
  let home: string;
  let runs: AgentRuns;
  const open: AgentRuns[] = [];

  const make = (env: Record<string, string> = {}, options: { permissionTimeoutMs?: number } = {}, fencesReviewer = true) => {
    const made = createAgentRuns(root, { slug: 'fix-typo', profiles: [fakeProfile(env, 'claude', fencesReviewer)], transcripts: createTranscripts(home), ...options });
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

  it('runs a prompt to the end and keeps the model, the cost and the usage', async () => {
    const run = startRun(`read ${join(root, NOTE)}`);
    expect(run.status).toBe('running');
    const done = await waitForRun(runs, run.id, ended);
    expect(done.run).toMatchObject({ status: 'done', model: 'Fake One', cost: { amount: 0.12, currency: 'USD' }, usage: { totalTokens: 30 }, by: 'octocat', role: 'author' });
    expect(messagesOf(done.events)).toEqual(['read:---\ntitle: Agent\n---\n\nBefore.\n']);
  });

  it('writes a note through the Studio for an author, and records it', async () => {
    const run = startRun(`write ${join(root, NOTE)} After.`);
    const done = await waitForRun(runs, run.id, ended);
    expect(messagesOf(done.events)).toEqual(['wrote']);
    expect(await readFile(join(root, NOTE), 'utf8')).toBe('After.');
    expect(done.run.writes).toEqual([NOTE]);
    expect(done.events.filter((event) => event.type === 'write')).toMatchObject([{ path: NOTE, bytes: 6 }]);
  });

  it('records the files the agent changes with its own tools, reported or not', async () => {
    const reported = join(root, 'content/notes/reported.mdx');
    const quiet = join(root, 'server-side.ts');
    const done = await waitForRun(runs, startRun(`edit ${reported} By its tool.\nsneak ${quiet} export {};`).id, ended);
    expect(done.events.filter((event) => event.type === 'changed')).toMatchObject([{ paths: ['content/notes/reported.mdx'] }, { paths: ['server-side.ts'] }]);
    expect(done.run.writes).toEqual(['content/notes/reported.mdx', 'server-side.ts']);
    await rm(reported);
    await rm(quiet);
  });

  it('says no for a reviewer whose agent cannot be held to reading, when it asks to edit', async () => {
    const unfenced = make({}, {}, false);
    const done = await waitForRun(unfenced, startRun('ask-edit\nask', 'reviewer', unfenced).id, ended);
    expect(done.events.filter((event) => event.type === 'answer')).toMatchObject([{ optionId: null, by: 'studio' }, { optionId: null, by: 'studio' }]);
    expect(messagesOf(done.events)).toEqual(['answer:cancelled', 'answer:cancelled']);
  });

  it('lets a reviewer read but not write', async () => {
    await writeFile(join(root, NOTE), 'Kept.');
    const run = startRun(`write ${join(root, NOTE)} Changed.`, 'reviewer');
    const done = await waitForRun(runs, run.id, ended);
    expect(messagesOf(done.events)[0]).toMatch(/^refused:.*reviewer reads only/);
    expect(await readFile(join(root, NOTE), 'utf8')).toBe('Kept.');
  });

  it('refuses reads and writes outside what the Studio allows', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'notes-studio-outside-'));
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(join(outside, 'secret.txt'), join(root, 'content/notes/link.mdx'));
    await writeFile(join(root, '.env'), 'TOKEN=1');
    const prompt = [
      `read ${join(outside, 'secret.txt')}`,
      `read ${join(root, 'content/notes/link.mdx')}`,
      `read ${join(root, '.env')}`,
      `read ${join(root, '.git/config')}`,
      `read ${root}/content/notes/../../../etc/passwd`,
      `write ${join(root, 'package.json')} {}`,
      `write ${join(root, 'content/notes/link.mdx')} replaced`,
      `write ${join(outside, 'new.mdx')} x`,
      `read ${join(root, 'package.json')}`,
    ].join('\n');
    const done = await waitForRun(runs, startRun(prompt).id, ended);
    const said = messagesOf(done.events);
    expect(said.slice(0, 8).every((message) => message.startsWith('refused:'))).toBe(true);
    // A repo file outside the editable areas can still be read.
    expect(said[8]).toBe('read:{}\n');
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('secret');
    await rm(join(root, 'content/notes/link.mdx'));
    await rm(join(root, '.env'));
    await rm(outside, { recursive: true, force: true });
  });

  it('asks for permission without the options that outlive the run, and passes the answer on', async () => {
    const run = startRun('ask');
    const asked = await waitForRun(runs, run.id, ({ events }) => events.some((event) => event.type === 'permission'));
    const permission = asked.events.find((event): event is Extract<RunEvent, { type: 'permission' }> => event.type === 'permission');
    expect(permission?.ask.options.map((option) => option.optionId)).toEqual(['once', 'no']);
    expect(() => { runs.answer(run.id, permission?.ask.id ?? '', 'always', 'octocat'); }).toThrow(/one of the options/);
    runs.answer(run.id, permission?.ask.id ?? '', 'once', 'octocat');
    const done = await waitForRun(runs, run.id, ended);
    expect(messagesOf(done.events)).toEqual(['answer:once']);
    expect(done.events.find((event) => event.type === 'answer')).toMatchObject({ optionId: 'once', by: 'octocat' });
    expect(() => { runs.answer(run.id, permission?.ask.id ?? '', 'once', null); }).toThrow(/not running/);
  });

  it('rejects a question nobody answers in time', async () => {
    const quick = make({}, { permissionTimeoutMs: 100 });
    const run = startRun('ask', 'author', quick);
    const done = await waitForRun(quick, run.id, ended);
    expect(messagesOf(done.events)).toEqual(['answer:cancelled']);
    expect(done.events.find((event) => event.type === 'answer')).toMatchObject({ optionId: null, by: null });
  });

  it('cancels a run, answering its open question', async () => {
    const run = startRun('ask\nhang');
    await waitForRun(runs, run.id, ({ events }) => events.some((event) => event.type === 'permission'));
    runs.cancel(run.id);
    const done = await waitForRun(runs, run.id, ended);
    expect(done.run.status).toBe('cancelled');
    expect(messagesOf(done.events)).toEqual(['answer:cancelled']);
  });

  it('stops an agent that ignores the cancel when the change request closes', async () => {
    const closing = make();
    const run = startRun('deaf', 'author', closing);
    await waitForRun(closing, run.id, ({ run: summary }) => summary.model !== null);
    const started = Date.now();
    await closing.close();
    expect(Date.now() - started).toBeLessThan(5000);
    expect((await closing.read(run.id)).run.status).toBe('cancelled');
    expect(() => startRun('read x', 'author', closing)).toThrow(/closing/);
  });

  it('reports an agent that crashes, with what it printed', async () => {
    const done = await waitForRun(runs, startRun('crash').id, ended);
    expect(done.run.status).toBe('failed');
    expect(done.run.error).toMatch(/Fake Agent stopped \(exit 3\): boom: the fake agent crashed/);
  });

  it('fails a run at once when its agent cannot be started, freeing its place', async () => {
    const broken = createAgentRuns(root, {
      slug: 'fix-typo',
      profiles: [{ ...fakeProfile(), command: () => { throw new Error('@agentclientprotocol/claude-agent-acp has no claude-agent-acp command'); } }],
      transcripts: createTranscripts(home),
    });
    open.push(broken);
    const run = startRun('env', 'author', broken);
    expect(run).toMatchObject({ status: 'failed', error: '@agentclientprotocol/claude-agent-acp has no claude-agent-acp command' });
    for (let index = 0; index < 3; index += 1) expect(startRun('env', 'author', broken).status).toBe('failed');
    expect((await broken.read(run.id)).run.status).toBe('failed');
  });

  it('says when the agent is not signed in', async () => {
    const unsigned = make({ FAKE_AGENT: 'auth' });
    const done = await waitForRun(unsigned, startRun('read x', 'author', unsigned).id, ended);
    expect(done.run).toMatchObject({ status: 'failed', error: 'Fake Agent is not signed in: sign in once in a terminal, then run again' });
  });

  it('starts the agent in the worktree without the Studio\'s GitHub secrets', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, { STUDIO_SECRET: 'x', GH_TOKEN: 'x', GITHUB_TOKEN: 'x' });
    try {
      const done = await waitForRun(runs, startRun('env').id, ended);
      expect(messagesOf(done.events)).toEqual([`env: cwd:${root}`]);
    } finally {
      process.env = saved;
    }
  });

  it('keeps transcripts on disk, newest first, and reads a run left running as failed', async () => {
    const first = await waitForRun(runs, startRun('env').id, ended);
    const second = await waitForRun(runs, startRun('env').id, ended);
    await runs.close();
    const again = make();
    const listed = await again.list();
    expect(listed.slice(0, 2).map((run) => run.id)).toEqual([second.run.id, first.run.id]);
    expect((await again.read(first.run.id)).events.map((event) => event.type)).toEqual(first.events.map((event) => event.type));

    const transcripts = createTranscripts(home);
    const stale = { ...first.run, id: 'zz-stale', status: 'running' as const, startedMs: Date.now() + 1000 };
    transcripts.append('fix-typo', stale.id, { type: 'start', at: stale.startedMs, run: stale });
    await transcripts.settled();
    expect((await again.list())[0]).toMatchObject({ id: 'zz-stale', status: 'failed', error: 'the Studio stopped during the run' });
    await expect(again.read('missing')).rejects.toThrow(/no such run/);
  });

  it('refuses a bad request and a fourth run at once', () => {
    expect(() => runs.start({ agent: 'nobody', role: 'author', prompt: 'x', by: null })).toThrow(/agent must be/);
    expect(() => runs.start({ agent: 'claude', role: 'owner', prompt: 'x', by: null })).toThrow(/role must be/);
    expect(() => runs.start({ agent: 'claude', role: 'author', prompt: '  ', by: null })).toThrow(/prompt must be/);
    for (let index = 0; index < 3; index += 1) startRun('hang');
    expect(() => startRun('hang')).toThrow(/3 agents are already running/);
  });
});
