import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { connectAgent, type AgentHooks } from '../../../server/agents/connection';
import { createAgentConversations, type AgentConversations } from '../../../server/agents/conversations';
import { createTranscripts } from '../../../server/agents/transcripts';
import { ended, fakeProfile, messagesOf, waitFor } from '../../support/agents';
import { makeGitWorktree } from '../../support/git';
import type { Worktree } from '../../support/studio';

// Many turns in one session, and the life of the agent process between them.
describe('agent conversations over many turns', () => {
  let worktree: Worktree;
  let root: string;
  let home: string;
  let store: string;
  const open: AgentConversations[] = [];

  // `way`: what the fake agent offers to take a session up again.
  const make = (way: 'load' | 'resume' | 'none' = 'resume', options: { idleMs?: number; cancelGraceMs?: number } = {}) => {
    const env = { FAKE_AGENT: way, FAKE_AGENT_STORE: store };
    const made = createAgentConversations(root, { slug: 'turns', profiles: [fakeProfile(env)], transcripts: createTranscripts(home), ...options });
    open.push(made);
    return made;
  };
  const start = (on: AgentConversations, prompt: string) => on.start({ agent: 'claude', role: 'author', prompt, by: 'octocat' });
  const sessionsOf = (events: Awaited<ReturnType<AgentConversations['read']>>['events']) => events.flatMap((event) => (event.type === 'session' ? [event] : []));
  const gone = (on: AgentConversations, id: string) => waitFor(on, id, ({ conversation }) => !conversation.live);

  beforeAll(async () => {
    worktree = await makeGitWorktree();
    root = await realpath(worktree.root);
    home = await mkdtemp(join(tmpdir(), 'notes-studio-turns-'));
    store = await mkdtemp(join(tmpdir(), 'notes-studio-turns-store-'));
  });

  afterEach(async () => {
    await Promise.all(open.splice(0).map((made) => made.close()));
  });

  afterAll(async () => {
    await worktree.remove();
    await rm(home, { recursive: true, force: true });
    await rm(store, { recursive: true, force: true });
  });

  it('sends a second message to the same session, where the agent sees the first', async () => {
    const conversations = make();
    const first = start(conversations, 'env');
    await waitFor(conversations, first.id, ended);
    await conversations.message(first.id, 'recall', 'hubot');
    const done = await waitFor(conversations, first.id, ended);
    expect(messagesOf(done.events).at(-1)).toBe('recall:env');
    expect(sessionsOf(done.events)).toMatchObject([{ how: 'new' }]);
    expect(done.events.filter((event) => event.type === 'turn')).toMatchObject([{ prompt: 'env', by: 'octocat' }, { prompt: 'recall', by: 'hubot' }]);
    expect(done.conversation).toMatchObject({ status: 'done', turns: 2, live: true, prompt: 'env', by: 'octocat', cost: { amount: 0.24, currency: 'USD' } });
    expect(done.conversation.sessionId).toBe(sessionsOf(done.events)[0]?.sessionId);
    const ends = done.events.flatMap((event) => (event.type === 'end' ? [event.turn] : []));
    expect(ends.map((turn) => turn.cost?.amount.toFixed(2))).toEqual(['0.12', '0.12']);
  });

  it('refuses a message while the agent is still answering', async () => {
    const conversations = make();
    const busy = start(conversations, 'hang');
    await expect(conversations.message(busy.id, 'recall', null)).rejects.toThrow(/still answering/);
    await expect(conversations.message('no-such', 'recall', null)).rejects.toThrow(/no such conversation/);
    await expect(conversations.message(busy.id, ' ', null)).rejects.toThrow(/prompt must be/);
  });

  it('cancels the second turn only: the third still goes to the same session', async () => {
    const conversations = make();
    const conversation = start(conversations, 'env');
    await waitFor(conversations, conversation.id, ended);
    await conversations.message(conversation.id, 'hang', null);
    await waitFor(conversations, conversation.id, ({ events }) => events.filter((event) => event.type === 'turn').length === 2);
    conversations.cancel(conversation.id);
    const cancelled = await waitFor(conversations, conversation.id, ended);
    expect(cancelled.conversation).toMatchObject({ status: 'cancelled', live: true });
    expect(() => { conversations.cancel(conversation.id); }).toThrow(/no turn is going on/);
    await conversations.message(conversation.id, 'recall', null);
    const done = await waitFor(conversations, conversation.id, ended);
    expect(messagesOf(done.events).at(-1)).toBe('recall:env|hang');
    expect(sessionsOf(done.events)).toHaveLength(1);
  });

  for (const [way, how] of [['resume', 'resumed'], ['load', 'loaded']] as const) {
    it(`stops an idle process, then takes the session up again by session/${way}`, async () => {
      const conversations = make(way, { idleMs: 150 });
      const conversation = start(conversations, 'env');
      await waitFor(conversations, conversation.id, ended);
      await gone(conversations, conversation.id);
      expect(conversations.agentsUp()).toEqual([]);
      await conversations.message(conversation.id, 'recall', null);
      const done = await waitFor(conversations, conversation.id, ended);
      expect(sessionsOf(done.events).map((event) => event.how)).toEqual(['new', how]);
      expect(sessionsOf(done.events)[1]?.sessionId).toBe(sessionsOf(done.events)[0]?.sessionId);
      // The agent remembers; the history session/load replays is not news.
      expect(messagesOf(done.events).filter((message) => message.startsWith('replay:'))).toEqual([]);
      expect(messagesOf(done.events).at(-1)).toBe('recall:env');
      expect(done.conversation).toMatchObject({ turns: 2, live: true, status: 'done' });
    });
  }

  it('starts a fresh session, marked, for an agent that can neither load nor resume', async () => {
    const conversations = make('none', { idleMs: 150 });
    const conversation = start(conversations, 'env');
    const first = await waitFor(conversations, conversation.id, ended);
    await gone(conversations, conversation.id);
    await conversations.message(conversation.id, 'recall', null);
    const done = await waitFor(conversations, conversation.id, ended);
    expect(sessionsOf(done.events).map((event) => event.how)).toEqual(['new', 'fresh']);
    expect(done.conversation.sessionId).not.toBe(first.conversation.sessionId);
    expect(messagesOf(done.events).at(-1)).toBe('recall:');
  });

  it('takes a conversation up again after the Studio restarts', async () => {
    const before = make();
    const conversation = start(before, 'env');
    await waitFor(before, conversation.id, ended);
    await before.close();
    const after = make();
    await after.message(conversation.id, 'recall', null);
    const done = await waitFor(after, conversation.id, ended);
    expect(messagesOf(done.events).at(-1)).toBe('recall:env');
    expect(sessionsOf(done.events).map((event) => event.how)).toEqual(['new', 'resumed']);
  });

  it('stops the idlest process for a fourth conversation, never one in a turn', async () => {
    const conversations = make();
    const oldest = start(conversations, 'env');
    await waitFor(conversations, oldest.id, ended);
    const busy = start(conversations, 'hang');
    const newer = start(conversations, 'env');
    await waitFor(conversations, newer.id, ended);
    expect(conversations.agentsUp()).toHaveLength(3);
    const fourth = start(conversations, 'env');
    await gone(conversations, oldest.id);
    expect(conversations.agentsUp().sort()).toEqual([busy.id, newer.id, fourth.id].sort());
    expect((await conversations.read(busy.id)).conversation.status).toBe('running');
  });

  it('stops every process of its conversations when the change request closes', async () => {
    const conversations = make();
    const ids = [start(conversations, 'env').id, start(conversations, 'env').id];
    for (const id of ids) await waitFor(conversations, id, ended);
    expect(conversations.agentsUp()).toHaveLength(2);
    await conversations.close();
    expect(conversations.agentsUp()).toEqual([]);
    for (const id of ids) expect((await conversations.read(id)).conversation.live).toBe(false);
    await expect(conversations.message(ids[0] ?? '', 'recall', null)).rejects.toThrow(/closing/);
  });

  it('deletes a conversation and its transcript, stopping its process, but not during a turn', async () => {
    const conversations = make();
    const kept = start(conversations, 'env');
    const deleted = start(conversations, 'env');
    await waitFor(conversations, deleted.id, ended);
    await waitFor(conversations, kept.id, ended);
    const busy = start(conversations, 'hang');
    await expect(conversations.remove(busy.id)).rejects.toThrow(/cancel the turn first/);
    await conversations.remove(deleted.id);
    expect(conversations.agentsUp()).not.toContain(deleted.id);
    await expect(conversations.read(deleted.id)).rejects.toThrow(/no such conversation/);
    expect((await conversations.list()).map((each) => each.id)).not.toContain(deleted.id);
    expect(existsSync(join(home, 'agents', 'turns', `${deleted.id}.jsonl`))).toBe(false);
    expect(existsSync(join(home, 'agents', 'turns', `${deleted.id}.json`))).toBe(false);
    await expect(conversations.remove('no-such')).rejects.toThrow(/no such conversation/);
    // A stopped conversation, read from disk, goes too.
    await conversations.close();
    const again = make();
    await again.remove(kept.id);
    await expect(again.read(kept.id)).rejects.toThrow(/no such conversation/);
  });

  it('opens a run kept before conversations as a one-turn conversation, and goes on with it', async () => {
    const dir = join(home, 'agents', 'turns');
    await mkdir(dir, { recursive: true });
    const run = {
      id: 'old-run', agent: 'claude', agentName: 'Fake Agent', role: 'author', prompt: 'Tighten the intro', model: 'Fake One', status: 'done', error: null,
      startedMs: 1000, endedMs: 2000, cost: { amount: 0.3, currency: 'USD' }, usage: null, writes: [], by: 'octocat',
    };
    const say = { type: 'update', at: 1500, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Shorter now.' } } };
    await writeFile(join(dir, 'old-run.jsonl'), [{ type: 'start', at: 1000, run: { ...run, status: 'running', endedMs: null } }, say, { type: 'end', at: 2000, run }].map((event) => JSON.stringify(event)).join('\n') + '\n');
    await writeFile(join(dir, 'old-run.json'), JSON.stringify(run));
    const conversations = make();
    expect((await conversations.list()).find((each) => each.id === 'old-run')).toMatchObject({ turns: 1, lastMs: 2000, sessionId: null, live: false, status: 'done' });
    const read = await conversations.read('old-run');
    expect(read.events.map((event) => event.type)).toEqual(['start', 'turn', 'update', 'end']);
    expect(read.events[1]).toMatchObject({ prompt: 'Tighten the intro', by: 'octocat' });
    expect(read.events[3]).toMatchObject({ turn: { status: 'done', cost: { amount: 0.3 } } });
    // It kept no session: the next message starts one, marked.
    await conversations.message('old-run', 'recall', null);
    const done = await waitFor(conversations, 'old-run', ended);
    expect(sessionsOf(done.events).map((event) => event.how)).toEqual(['fresh']);
    expect(done.conversation).toMatchObject({ turns: 2, cost: { amount: 0.42 } });
    // Its first turn stays once the new one is on disk.
    await conversations.close();
    const again = make();
    const stored = await again.read('old-run');
    expect(stored.events.flatMap((event) => (event.type === 'turn' ? [event.prompt] : []))).toEqual(['Tighten the intro', 'recall']);
    expect(stored.events.filter((event) => event.type === 'turn' || event.type === 'end').map((event) => event.type)).toEqual(['turn', 'end', 'turn', 'end']);
  });

  it('refuses a message to a conversation being deleted, and leaves nothing of it', async () => {
    const conversations = make();
    const conversation = start(conversations, 'env');
    await waitFor(conversations, conversation.id, ended);
    const removing = conversations.remove(conversation.id);
    await expect(conversations.message(conversation.id, 'recall', null)).rejects.toThrow(/no such conversation/);
    await removing;
    await conversations.close();
    expect(existsSync(join(home, 'agents', 'turns', `${conversation.id}.jsonl`))).toBe(false);
    expect(existsSync(join(home, 'agents', 'turns', `${conversation.id}.json`))).toBe(false);
  });

  it('numbers the events it records, so a read and the stream line up', async () => {
    const conversations = make();
    const conversation = start(conversations, 'env');
    const done = await waitFor(conversations, conversation.id, ended);
    // Chunks are joined in memory; `seq` counts every event recorded.
    expect(done.seq).toBeGreaterThanOrEqual(done.events.length);
    await conversations.close();
    const stored = await make().read(conversation.id);
    expect(stored.seq).toBe(stored.events.length);
  });
});

describe('an agent connection between turns', () => {
  let worktree: Worktree;
  let root: string;
  const hooks: AgentHooks = { update: () => undefined, model: () => undefined, cost: () => undefined, write: () => Promise.resolve(), ask: () => Promise.resolve(null) };

  beforeAll(async () => {
    worktree = await makeGitWorktree();
    root = await realpath(worktree.root);
  });

  afterAll(async () => {
    await worktree.remove();
  });

  it('does nothing on a cancel between turns, so the next turn is not stopped', async () => {
    const agent = connectAgent(fakeProfile(), 'author', root, hooks, { cancelGraceMs: 100 });
    await agent.prompt('env');
    agent.cancel();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await agent.prompt('recall')).stopReason).toBe('end_turn');
    agent.kill();
  });

  it('sends no message cancelled while the session opens', async () => {
    const said: string[] = [];
    const listen: AgentHooks = {
      ...hooks,
      update: (update) => { if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') said.push(update.content.text); },
    };
    const agent = connectAgent(fakeProfile(), 'author', root, listen, { cancelGraceMs: 5000 });
    const first = agent.prompt('env');
    agent.cancel();
    expect((await first).stopReason).toBe('cancelled');
    await agent.prompt('recall');
    // The agent never saw the cancelled message.
    expect(said.at(-1)).toBe('recall:');
    agent.kill();
  });
});
