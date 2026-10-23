import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import { atLeast } from '../auth/shared.ts';
import { createKeyedLock } from '../files/store.ts';
import { HttpError } from '../http.ts';
import type { Viewer } from '../security/access.ts';
import { connectAgent, type AgentHooks, type AgentSession } from './connection.ts';
import { writeForAgent } from './fs-policy.ts';
import type { AgentProfile } from './profiles.ts';
import { IDLE_MS, idlest, MAX_LIVE_AGENTS } from './sessions.ts';
import { PERMISSION_TIMEOUT_MS, summaryOf, type Conversation, type ConversationEvent, type ConversationRead, type Cost, type PermissionAsk, type StreamEvent, type TurnEnd } from './shared.ts';
import type { Transcripts } from './transcripts.ts';
import { changedSince, worktreePathOf, worktreeState } from './worktree.ts';

const PROMPT_MAX = 20_000;
const HEARTBEAT_MS = 25_000;
// What a reviewer may still ask for; the Studio says no to anything else.
const READING_KINDS = new Set(['read', 'search', 'fetch', 'think']);
const EDIT_KINDS = new Set(['edit', 'delete', 'move']);

type Pending = { ask: PermissionAsk; resolve: (optionId: string | null) => void; timer: NodeJS.Timeout };
// `before`: the worktree as the turn found it. `stopping`: cancelled or
// killed, it may still be ending. `answered`: the agent has ended it, and
// its end is being recorded. `cost`: what the agent reported for it.
type Turn = { before: Promise<Map<string, number | null>>; stopping: boolean; answered: boolean; costBefore: number; cost: Cost | null };
// A conversation held in memory: while its process is up or a turn runs.
// `reported`: the cost the process reported last (it adds up over its
// turns), and `base` that figure when the turn began.
type Live = {
  summary: Conversation;
  events: ConversationEvent[];
  // Events recorded so far, chunks counted one by one: the stream's `seq`.
  count: number;
  pending: Map<string, Pending>;
  profile: AgentProfile;
  agent: AgentSession | null;
  reported: number;
  base: number;
  turn: Turn | null;
  // Until the turn's end is recorded.
  ending: Promise<void>;
  idle: NodeJS.Timeout | undefined;
  deleted: boolean;
};

const newId = () => `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;

// A text chunk the agent streams (`agent_message_chunk`, `agent_thought_chunk`).
function chunkOf(event: ConversationEvent) {
  if (event.type !== 'update') return null;
  const { update } = event;
  if ((update.sessionUpdate !== 'agent_message_chunk' && update.sessionUpdate !== 'agent_thought_chunk') || update.content.type !== 'text') return null;
  return { kind: update.sessionUpdate, text: update.content.text };
}

// Adds `event` to the events held in memory, joining text chunks of one
// kind in a row, so a long answer is one event there.
function hold(events: ConversationEvent[], event: ConversationEvent) {
  const chunk = chunkOf(event);
  const last = events.at(-1);
  const previous = last === undefined ? null : chunkOf(last);
  if (chunk !== null && previous !== null && previous.kind === chunk.kind) {
    events[events.length - 1] = { type: 'update', at: event.at, update: { sessionUpdate: chunk.kind, content: { type: 'text', text: previous.text + chunk.text } } };
  } else events.push(event);
}

function promptOf(prompt: unknown) {
  if (typeof prompt !== 'string' || prompt.trim() === '') throw new HttpError(400, 'prompt must be some text');
  if (prompt.length > PROMPT_MAX) throw new HttpError(413, `prompt must be at most ${String(PROMPT_MAX)} characters`);
  return prompt;
}

// A conversation as read from disk: a turn left running by a Studio that stopped failed.
const ended = (conversation: Conversation): Conversation =>
  conversation.status === 'running' ? { ...conversation, status: 'failed', error: 'the Studio stopped during the turn', live: false } : { ...conversation, live: false };

export type AgentConversationsOptions = {
  slug: string;
  profiles: AgentProfile[];
  transcripts: Transcripts;
  // The worktree's notes lock (workspace.ts): agent writes wait for renames and commits.
  lock?: ReturnType<typeof createKeyedLock>;
  permissionTimeoutMs?: number;
  idleMs?: number;
  cancelGraceMs?: number;
};

// The agent conversations of one change request's worktree. A conversation
// is one ACP session over many turns (connection.ts); its agent process
// stays up between turns until it idles out (sessions.ts), and a message
// after that takes the session up again. Every event goes to the
// transcript and to every open event stream (GET /api/agents/events).
export function createAgentConversations(
  root: string,
  { slug, profiles, transcripts, lock = createKeyedLock(), permissionTimeoutMs = PERMISSION_TIMEOUT_MS, idleMs = IDLE_MS, cancelGraceMs }: AgentConversationsOptions,
) {
  const live = new Map<string, Live>();
  const streams = new Map<ServerResponse, Viewer>();
  let closed = false;
  const closing = () => closed;
  // Ids being deleted, from the call on: a message meanwhile is refused,
  // whether the conversation is held in memory or read from disk.
  const removing = new Set<string>();

  // To every stream whose viewer may still read; one who may not is closed.
  const broadcast = (frame: string) => {
    for (const [stream, viewer] of streams) {
      if (atLeast(viewer.current(), 'reader')) stream.write(frame);
      else {
        streams.delete(stream);
        stream.end();
      }
    }
  };
  const send = (event: StreamEvent) => { broadcast(`data: ${JSON.stringify(event)}\n\n`); };
  const heartbeat = setInterval(() => { broadcast(': heartbeat\n\n'); }, HEARTBEAT_MS);
  heartbeat.unref();

  // Every event goes to the transcript and the streams as it comes, and is
  // held in memory for a read or a stream that opens.
  const record = (conversation: Live, event: ConversationEvent) => {
    if (conversation.deleted) return;
    hold(conversation.events, event);
    conversation.count += 1;
    transcripts.append(slug, conversation.summary.id, event);
    send({ ...event, conversationId: conversation.summary.id, seq: conversation.count });
  };

  const changed = (conversation: Live, change: Partial<Conversation>) => {
    conversation.summary = { ...conversation.summary, ...change };
    record(conversation, { type: 'summary', at: Date.now(), conversation: conversation.summary });
  };

  const settle = (conversation: Live, id: string, optionId: string | null, by: string | null) => {
    const pending = conversation.pending.get(id);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    conversation.pending.delete(id);
    record(conversation, { type: 'answer', at: Date.now(), id, optionId, by });
    pending.resolve(optionId);
  };

  // Files the agent changed with its own tools: one event, and the summary.
  const touched = (conversation: Live, paths: string[]) => {
    const fresh = paths.filter((path) => !conversation.summary.writes.includes(path));
    if (fresh.length === 0) return;
    record(conversation, { type: 'changed', at: Date.now(), paths: fresh });
    changed(conversation, { writes: [...conversation.summary.writes, ...fresh] });
  };

  const ask = (conversation: Live, request: RequestPermissionRequest) =>
    new Promise<string | null>((resolve) => {
      const asked: PermissionAsk = { id: randomBytes(6).toString('hex'), toolCall: request.toolCall, options: request.options };
      if (conversation.turn === null || conversation.turn.stopping) {
        resolve(null);
        return;
      }
      const timer = setTimeout(() => { settle(conversation, asked.id, null, null); }, permissionTimeoutMs);
      timer.unref();
      conversation.pending.set(asked.id, { ask: asked, resolve, timer });
      record(conversation, { type: 'permission', at: Date.now(), ask: asked });
      // A reviewer reads: whatever else it asks for (an edit, a command, an
      // escalation out of its sandbox, a tool of no kind), the Studio says no.
      if (conversation.summary.role === 'reviewer' && !READING_KINDS.has(request.toolCall.kind ?? '')) settle(conversation, asked.id, null, 'studio');
    });

  const hooks = (conversation: Live): AgentHooks => ({
    update: (update) => {
      record(conversation, { type: 'update', at: Date.now(), update });
      // An edit made with the agent's own tool, once it is done.
      if ((update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') && update.status === 'completed' && EDIT_KINDS.has(update.kind ?? '')) {
        touched(conversation, (update.locations ?? []).flatMap((location) => worktreePathOf(root, location.path) ?? []));
      }
    },
    model: (model) => { if (model !== conversation.summary.model) changed(conversation, { model }); },
    // The process's figure adds up over its turns: the turn's is what it grew by.
    cost: (cost) => {
      conversation.reported = cost.amount;
      const { turn } = conversation;
      if (turn === null) return;
      turn.cost = { amount: Math.max(0, cost.amount - conversation.base), currency: cost.currency };
      changed(conversation, { cost: { amount: turn.costBefore + turn.cost.amount, currency: cost.currency } });
    },
    write: async (path, content) => {
      const written = await lock('notes', () => writeForAgent(root, path, content));
      record(conversation, { type: 'write', at: Date.now(), path: written.path, bytes: written.bytes });
      if (!conversation.summary.writes.includes(written.path)) changed(conversation, { writes: [...conversation.summary.writes, written.path] });
    },
    ask: (request) => ask(conversation, request),
  });

  // Drops a conversation from memory once it has neither a process nor a turn.
  const release = (conversation: Live) => {
    // A conversation being deleted leaves once its files are gone.
    if (conversation.agent !== null || conversation.turn !== null || conversation.deleted) return;
    clearTimeout(conversation.idle);
    if (live.get(conversation.summary.id) === conversation) live.delete(conversation.summary.id);
  };

  // Stops the conversation's process; the place it held is free at once.
  const stopAgent = (conversation: Live) => {
    const { agent } = conversation;
    clearTimeout(conversation.idle);
    if (agent === null) return;
    conversation.agent = null;
    agent.kill();
  };

  // A place for one more process: the one idle longest stops for it.
  const makeRoom = () => {
    const up = [...live.values()].filter((conversation) => conversation.agent !== null);
    if (up.length < MAX_LIVE_AGENTS) return;
    const id = idlest(up.map((conversation) => ({ id: conversation.summary.id, busy: conversation.turn !== null, lastMs: conversation.summary.lastMs })));
    const stopping = id === null ? undefined : live.get(id);
    if (stopping === undefined) throw new HttpError(409, `${String(MAX_LIVE_AGENTS)} agents are already working here: wait for one or cancel it`);
    stopAgent(stopping);
  };

  // Starts the conversation's agent process on its session, or a new one.
  const connect = (conversation: Live) => {
    const agent = connectAgent(conversation.profile, conversation.summary.role, root, hooks(conversation), { resume: conversation.summary.sessionId, cancelGraceMs });
    conversation.agent = agent;
    conversation.reported = 0;
    conversation.base = 0;
    agent.ready.then(({ sessionId, how }) => {
      if (conversation.agent !== agent) return;
      // A new session after earlier turns (a run kept no session) remembers none of them.
      const fresh = how === 'new' && conversation.summary.turns > 1;
      record(conversation, { type: 'session', at: Date.now(), how: fresh ? 'fresh' : how, sessionId });
      changed(conversation, { sessionId, live: true });
    }, () => undefined);
    void agent.exited.then(() => {
      if (conversation.agent === agent) conversation.agent = null;
      if (conversation.agent !== null) return;
      if (conversation.summary.live) changed(conversation, { live: false });
      release(conversation);
    });
    return agent;
  };

  // Records a turn's end. What differs in the worktree since it began, the
  // agent's own tools changed (or a person meanwhile).
  const finish = async (conversation: Live, status: TurnEnd['status'], error: string | null, usage: TurnEnd['usage']) => {
    const { turn } = conversation;
    if (turn === null) return;
    for (const id of [...conversation.pending.keys()]) settle(conversation, id, null, null);
    const [start, end] = await Promise.all([turn.before.catch(() => null), worktreeState(root).catch(() => null)]);
    if (start !== null && end !== null) touched(conversation, changedSince(start, end));
    const now = Date.now();
    conversation.summary = { ...conversation.summary, status, error, endedMs: now, lastMs: now, usage, live: conversation.agent !== null };
    record(conversation, { type: 'end', at: now, conversation: conversation.summary, turn: { status, error, cost: turn.cost, usage } });
    conversation.turn = null;
    if (conversation.agent !== null && !closed) {
      conversation.idle = setTimeout(() => { stopAgent(conversation); }, idleMs);
      conversation.idle.unref();
    }
    release(conversation);
  };

  // One turn: the message goes to the conversation's process, started (and
  // its session taken up again) when it is not up.
  const turn = (conversation: Live, prompt: string, by: string | null) => {
    clearTimeout(conversation.idle);
    const before = worktreeState(root);
    before.catch(() => undefined);
    conversation.turn = { before, stopping: false, answered: false, costBefore: conversation.summary.cost?.amount ?? 0, cost: null };
    const now = Date.now();
    record(conversation, { type: 'turn', at: now, prompt, by });
    changed(conversation, { status: 'running', error: null, endedMs: null, lastMs: now, turns: conversation.summary.turns + 1 });
    let agent = conversation.agent;
    try {
      agent ??= connect(conversation);
    } catch (error) {
      // A profile that cannot even name its command (its package gone).
      const message = (error as Error).message;
      conversation.summary = { ...conversation.summary, status: 'failed', error: message };
      conversation.ending = finish(conversation, 'failed', message, null);
      return;
    }
    conversation.base = conversation.reported;
    const current = conversation.turn;
    conversation.ending = agent.prompt(prompt).then(
      (response) => {
        current.answered = true;
        return finish(conversation, current.stopping || response.stopReason === 'cancelled' ? 'cancelled' : 'done', null, response.usage ?? null);
      },
      (error: unknown) => {
        current.answered = true;
        return finish(conversation, current.stopping ? 'cancelled' : 'failed', current.stopping ? null : (error as Error).message, null);
      },
    );
  };

  const profileOf = (agent: unknown) => {
    const profile = profiles.find((candidate) => candidate.id === agent);
    if (profile === undefined) throw new HttpError(400, 'agent must be one of the Studio\'s agents');
    return profile;
  };

  // A conversation as kept on disk: its events and last known summary.
  const stored = async (id: string) => {
    await transcripts.settled();
    const events = await transcripts.read(slug, id);
    const last = events === null ? undefined : [...events].reverse().map(summaryOf).find((summary) => summary !== null);
    if (events === null || last === undefined) throw new HttpError(404, `no such conversation: ${id}`);
    return { events, summary: ended(last) };
  };

  // A conversation from disk, back in memory for a new turn.
  const revive = async (id: string) => {
    const { events, summary } = await stored(id);
    const known = live.get(id);
    if (known !== undefined) return known;
    // Deleted while it was read: it is not held again.
    if (removing.has(id)) throw new HttpError(404, `no such conversation: ${id}`);
    const held: ConversationEvent[] = [];
    for (const event of events) hold(held, event);
    const conversation: Live = {
      summary, events: held, count: events.length, pending: new Map(), profile: profileOf(summary.agent), agent: null, reported: 0, base: 0, turn: null, ending: Promise.resolve(), idle: undefined, deleted: false,
    };
    live.set(id, conversation);
    return conversation;
  };

  const liveTurn = (id: string) => {
    const conversation = live.get(id);
    if (conversation?.turn == null) throw new HttpError(409, 'no turn is going on in this conversation');
    return conversation;
  };

  return {
    // A new conversation, with its first message.
    start({ agent, role, prompt, by }: { agent: unknown; role: unknown; prompt: unknown; by: string | null }): Conversation {
      if (closed) throw new HttpError(409, 'this change request is closing');
      const profile = profileOf(agent);
      if (role !== 'author' && role !== 'reviewer') throw new HttpError(400, 'role must be author or reviewer');
      const text = promptOf(prompt);
      makeRoom();
      const now = Date.now();
      const summary: Conversation = {
        id: newId(), agent: profile.id, agentName: profile.name, role, prompt: text, model: null, status: 'running', error: null,
        startedMs: now, endedMs: null, lastMs: now, turns: 0, sessionId: null, live: false, cost: null, usage: null, writes: [], by,
      };
      const conversation: Live = { summary, events: [], count: 0, pending: new Map(), profile, agent: null, reported: 0, base: 0, turn: null, ending: Promise.resolve(), idle: undefined, deleted: false };
      live.set(summary.id, conversation);
      record(conversation, { type: 'start', at: now, conversation: summary });
      turn(conversation, text, by);
      return conversation.summary;
    },

    // The next message of a conversation, in the same session.
    async message(id: string, prompt: unknown, by: string | null): Promise<Conversation> {
      if (closed) throw new HttpError(409, 'this change request is closing');
      const text = promptOf(prompt);
      const conversation = live.get(id) ?? (await revive(id));
      // It may have begun closing, or the conversation been deleted, while
      // it was read from disk: then it is not left held in memory.
      if (closing() || conversation.deleted || removing.has(id)) {
        release(conversation);
        if (closing()) throw new HttpError(409, 'this change request is closing');
        throw new HttpError(404, `no such conversation: ${id}`);
      }
      if (conversation.turn !== null) throw new HttpError(409, 'the agent is still answering: wait for it, or cancel the turn');
      if (conversation.agent === null) {
        try {
          makeRoom();
        } catch (error) {
          release(conversation);
          throw error;
        }
      }
      turn(conversation, text, by);
      return conversation.summary;
    },

    // Last active first; the ones on disk once their last events are written.
    async list(): Promise<Conversation[]> {
      await transcripts.settled();
      const stored = await transcripts.list(slug);
      return stored.map((conversation) => live.get(conversation.id)?.summary ?? ended(conversation));
    },

    async read(id: string): Promise<ConversationRead> {
      const conversation = live.get(id);
      if (conversation !== undefined) return { conversation: conversation.summary, events: [...conversation.events], seq: conversation.count };
      const { events, summary } = await stored(id);
      return { conversation: summary, events, seq: events.length };
    },

    answer(id: string, askId: string, optionId: unknown, by: string | null) {
      const conversation = liveTurn(id);
      const pending = conversation.pending.get(askId);
      if (pending === undefined) throw new HttpError(409, 'this question was already answered');
      if (optionId !== null && !pending.ask.options.some((option) => option.optionId === optionId)) {
        throw new HttpError(400, 'optionId must be one of the options asked, or null to reject');
      }
      settle(conversation, askId, optionId as string | null, by);
    },

    // Stops the turn going on, not the conversation. Pending questions are
    // answered "cancelled", as ACP asks of a client, and later ones are not asked.
    cancel(id: string) {
      const conversation = liveTurn(id);
      const { turn: current } = conversation;
      // Too late: the agent has answered, and its end is being recorded.
      if (current === null || current.answered) return;
      current.stopping = true;
      for (const askId of [...conversation.pending.keys()]) settle(conversation, askId, null, null);
      conversation.agent?.cancel();
    },

    // Deletes a conversation and its transcript, stopping its process. Not
    // while a turn runs. The agent's own record of the session stays.
    async remove(id: string) {
      const conversation = live.get(id);
      if (conversation?.turn != null) throw new HttpError(409, 'the agent is still answering: cancel the turn first');
      removing.add(id);
      try {
        if (conversation === undefined) {
          await transcripts.settled();
          if ((await transcripts.read(slug, id)) === null) throw new HttpError(404, `no such conversation: ${id}`);
        } else {
          // Held in memory, and refused a message, until its files are gone.
          conversation.deleted = true;
          const { agent } = conversation;
          stopAgent(conversation);
          if (agent !== null) await agent.exited;
        }
        await transcripts.removeOne(slug, id);
        if (conversation !== undefined && live.get(id) === conversation) live.delete(id);
      } finally {
        removing.delete(id);
      }
      send({ type: 'deleted', at: Date.now(), conversationId: id });
    },

    // GET /api/agents/events: every event of every conversation from now
    // on, after a snapshot of each one with a turn going on.
    subscribe(response: ServerResponse, viewer: Viewer) {
      if (closed) {
        response.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'this change request is closing' }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      response.write('retry: 1000\n\n');
      for (const conversation of live.values()) {
        if (conversation.turn === null || conversation.deleted) continue;
        const snapshot: StreamEvent = { type: 'snapshot', at: Date.now(), conversationId: conversation.summary.id, conversation: conversation.summary, events: conversation.events, seq: conversation.count };
        response.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      }
      streams.set(response, viewer);
      response.on('close', () => streams.delete(response));
    },

    // Stops every process and waits for the turns' ends (a discard, the
    // server closing).
    async close() {
      closed = true;
      clearInterval(heartbeat);
      const all = [...live.values()];
      const exits = all.flatMap((conversation) => (conversation.agent === null ? [] : [conversation.agent.exited]));
      for (const conversation of all) {
        if (conversation.turn !== null) conversation.turn.stopping = true;
        stopAgent(conversation);
      }
      await Promise.all([...all.map((conversation) => conversation.ending.catch(() => undefined)), ...exits]);
      await transcripts.settled();
      for (const stream of streams.keys()) stream.end();
      streams.clear();
    },

    // Agent processes up now, for the tests.
    agentsUp: () => [...live.values()].filter((conversation) => conversation.agent !== null).map((conversation) => conversation.summary.id),
  };
}

export type AgentConversations = ReturnType<typeof createAgentConversations>;
