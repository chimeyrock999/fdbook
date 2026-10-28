// A conversation's events as the agent panel shows them: each message a
// person sent, the agent's text and thoughts joined into paragraphs, each
// tool call once with its latest state, the plan, questions with their
// answers, the files written, where a process took the session up, and how
// each turn ended.

import { summaryOf, type PermissionAsk, type SessionStart, type StreamEvent, type ToolCallUpdate, type TurnEnd } from '../../server/agents/shared';
import type { Conversation, ConversationEvent, ConversationRead, MessageContext } from '../api/agents';

export type PlanEntry = { content: string; status: 'pending' | 'in_progress' | 'completed' };

export type TranscriptItem =
  // `from`: the chat on main that started this one (its first message).
  | { kind: 'prompt'; key: string; text: string; by: string | null; at: number; context: MessageContext | null; from: string | null }
  | { kind: 'message'; key: string; text: string }
  | { kind: 'thought'; key: string; text: string }
  | { kind: 'tool'; key: string; call: ToolCallUpdate }
  | { kind: 'plan'; key: string; entries: PlanEntry[] }
  | { kind: 'ask'; key: string; ask: PermissionAsk; at: number; answer: { optionId: string | null; by: string | null } | null }
  | { kind: 'write'; key: string; path: string }
  // A process took the session up after the first: only shown then.
  | { kind: 'session'; key: string; how: Exclude<SessionStart, 'new'> }
  | { kind: 'proposal'; key: string; path: string; hunks: number }
  // The change request the agent opened from main, and the chat it started there.
  | { kind: 'handoff'; key: string; slug: string; name: string; branch: string; chat: string | null }
  | { kind: 'turn-end'; key: string; turn: TurnEnd; index: number; ms: number };

export function transcriptOf(events: ConversationEvent[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const tools = new Map<string, Extract<TranscriptItem, { kind: 'tool' }>>();
  const asks = new Map<string, Extract<TranscriptItem, { kind: 'ask' }>>();
  // One plan per turn, where it first showed, kept up to date.
  let plan: Extract<TranscriptItem, { kind: 'plan' }> | null = null;
  let turns = 0;
  let turnAt = 0;
  const key = (kind: string) => `${kind}-${String(items.length)}`;
  // Chunks of one kind in a row make one paragraph.
  const append = (kind: 'message' | 'thought', text: string) => {
    const last = items.at(-1);
    if (last?.kind === kind) last.text += text;
    else items.push({ kind, key: key(kind), text });
  };

  for (const event of events) {
    if (event.type === 'turn') {
      turns += 1;
      turnAt = event.at;
      plan = null;
      items.push({ kind: 'prompt', key: key('prompt'), text: event.prompt, by: event.by, at: event.at, context: event.context ?? null, from: event.from ?? null });
    } else if (event.type === 'session') {
      if (event.how !== 'new') items.push({ kind: 'session', key: key('session'), how: event.how });
    } else if (event.type === 'end') {
      items.push({ kind: 'turn-end', key: key('turn-end'), turn: event.turn, index: turns, ms: event.at - turnAt });
    } else if (event.type === 'permission') {
      const item = { kind: 'ask' as const, key: `ask-${event.ask.id}`, ask: event.ask, at: event.at, answer: null };
      asks.set(event.ask.id, item);
      items.push(item);
    } else if (event.type === 'answer') {
      const item = asks.get(event.id);
      if (item) item.answer = { optionId: event.optionId, by: event.by };
    } else if (event.type === 'write') items.push({ kind: 'write', key: key('write'), path: event.path });
    else if (event.type === 'proposal') items.push({ kind: 'proposal', key: `proposal-${event.id}`, path: event.path, hunks: event.hunks });
    else if (event.type === 'handoff') items.push({ kind: 'handoff', key: `handoff-${event.slug}`, slug: event.slug, name: event.name, branch: event.branch, chat: event.chat });
    else if (event.type === 'changed') for (const path of event.paths) items.push({ kind: 'write', key: key('write'), path });
    else if (event.type === 'update') {
      const { update } = event;
      if ((update.sessionUpdate === 'agent_message_chunk' || update.sessionUpdate === 'agent_thought_chunk') && update.content.type === 'text') {
        append(update.sessionUpdate === 'agent_message_chunk' ? 'message' : 'thought', update.content.text);
      } else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
        const known = tools.get(update.toolCallId);
        if (known) known.call = { ...known.call, ...withoutNulls(update) };
        else {
          const item = { kind: 'tool' as const, key: `tool-${update.toolCallId}`, call: withoutNulls(update) };
          tools.set(update.toolCallId, item);
          items.push(item);
        }
      } else if (update.sessionUpdate === 'plan') {
        if (plan === null) {
          plan = { kind: 'plan', key: key('plan'), entries: update.entries };
          items.push(plan);
        } else plan.entries = update.entries;
      }
    }
  }
  return items;
}

// A tool call update leaves out (or nulls) what did not change.
function withoutNulls(update: ToolCallUpdate & { sessionUpdate?: string }): ToolCallUpdate {
  return Object.fromEntries(Object.entries(update).filter(([name, value]) => name !== 'sessionUpdate' && value !== null && value !== undefined)) as ToolCallUpdate;
}

// The questions of a conversation still waiting for an answer.
export function openAsks(events: ConversationEvent[]): PermissionAsk[] {
  const answered = new Set(events.flatMap((event) => (event.type === 'answer' ? [event.id] : [])));
  return events.flatMap((event) => (event.type === 'permission' && !answered.has(event.ask.id) ? [event.ask] : []));
}

// The first question waiting for an answer among `conversations`, oldest
// asked first, with its conversation.
export function firstAsk(conversations: Conversation[], events: Record<string, ConversationEvent[] | undefined>) {
  let first: { conversation: Conversation; ask: PermissionAsk; at: number } | null = null;
  for (const conversation of conversations) {
    const own = events[conversation.id] ?? [];
    const ask = openAsks(own).at(0);
    if (ask === undefined) continue;
    const at = own.find((event) => event.type === 'permission' && event.ask.id === ask.id)?.at ?? Date.now();
    if (first === null || at < first.at) first = { conversation, ask, at };
  }
  return first;
}

// The conversations, last active first; the events of those this page
// holds (read, or followed from their start), with the `seq` of the last
// one applied; the stream's events for those being read meanwhile; and how
// many Keep/Revert decisions each turn had (`<id>:<turn>`), so its list is
// read again.
export type ConversationsState = {
  conversations: Conversation[];
  events: Record<string, ConversationEvent[]>;
  seqs: Record<string, number>;
  waiting: Record<string, Extract<StreamEvent, { seq: number }>[]>;
  decisions: Record<string, number>;
};

export const EMPTY_CONVERSATIONS: ConversationsState = { conversations: [], events: {}, seqs: {}, waiting: {}, decisions: {} };

export const decisionKey = (id: string, turn: number) => `${id}:${String(turn)}`;

// An event of the stream as its conversation recorded it.
function recordedOf(event: Extract<StreamEvent, { seq: number }>): ConversationEvent {
  const copy: Partial<typeof event> = { ...event };
  delete copy.conversationId;
  delete copy.seq;
  return copy as ConversationEvent;
}

const byActivity = (list: Conversation[]) => [...list].sort((a, b) => b.lastMs - a.lastMs);
const without = <T>(record: Record<string, T>, id: string) => Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));
const withSummary = (conversations: Conversation[], summary: Conversation | null) =>
  summary === null ? conversations : byActivity([summary, ...conversations.filter((each) => each.id !== summary.id)]);

// A conversation as read whole (`client.read`, or a snapshot on the
// stream), with the stream's events that came while it was read and are
// newer than what it holds.
export function withRead(state: ConversationsState, id: string, read: ConversationRead): ConversationsState {
  const later = (state.waiting[id] ?? []).filter((event) => event.seq > read.seq);
  const events = [...read.events, ...later.map(recordedOf)];
  const seq = later.at(-1)?.seq ?? read.seq;
  return {
    ...state,
    conversations: withSummary(state.conversations, [...events].reverse().map(summaryOf).find((summary) => summary !== null) ?? read.conversation),
    events: { ...state.events, [id]: events },
    seqs: { ...state.seqs, [id]: seq },
    waiting: without(state.waiting, id),
  };
}

// Begins reading a conversation (again, after the stream was down): the
// stream's events for it wait meanwhile.
export const reading = (state: ConversationsState, id: string): ConversationsState =>
  id in state.waiting ? state : { ...state, waiting: { ...state.waiting, [id]: [] } };

// Gives up reading a conversation: what it held stays.
export const unread = (state: ConversationsState, id: string): ConversationsState => ({ ...state, waiting: without(state.waiting, id) });

// Whether the page should read a conversation the stream speaks of: it
// neither holds it nor reads it, and the event is not one it can start from.
export const unheld = (state: ConversationsState, event: StreamEvent) =>
  event.type !== 'deleted' && event.type !== 'decided' && event.type !== 'snapshot' && event.type !== 'start' && event.type !== 'summary' && !(event.conversationId in state.events) && !(event.conversationId in state.waiting);

// Folds one streamed event in. A start, or a snapshot on a reconnect,
// begins the conversation's events afresh; an event it already has (by
// `seq`) is skipped; one for a conversation being read waits for the read.
export function withEvent(state: ConversationsState, event: StreamEvent): ConversationsState {
  const id = event.conversationId;
  if (event.type === 'deleted') {
    return { ...state, conversations: state.conversations.filter((each) => each.id !== id), events: without(state.events, id), seqs: without(state.seqs, id), waiting: without(state.waiting, id) };
  }
  if (event.type === 'decided') {
    const key = decisionKey(id, event.turn);
    return { ...state, decisions: { ...state.decisions, [key]: (state.decisions[key] ?? 0) + 1 } };
  }
  if (event.type === 'snapshot') return withRead({ ...state, waiting: without(state.waiting, id) }, id, event);
  const { seq } = event;
  const recorded = recordedOf(event);
  const conversations = withSummary(state.conversations, summaryOf(recorded));
  if (id in state.waiting) return { ...state, conversations, waiting: { ...state.waiting, [id]: [...(state.waiting[id] ?? []), event] } };
  if (recorded.type === 'start') return { ...state, conversations, events: { ...state.events, [id]: [recorded] }, seqs: { ...state.seqs, [id]: seq } };
  if (!(id in state.events) || seq <= (state.seqs[id] ?? 0)) return { ...state, conversations };
  return { ...state, conversations, events: { ...state.events, [id]: [...state.events[id], recorded] }, seqs: { ...state.seqs, [id]: seq } };
}

// The conversations as listed by the server, keeping those with a turn
// going on that it does not list yet, and dropping what is held of any gone.
export const withList = (state: ConversationsState, listed: Conversation[]): ConversationsState => {
  const going = state.conversations.filter((each) => each.status === 'running' && !listed.some((other) => other.id === each.id));
  const conversations = byActivity([...going, ...listed]);
  const kept = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => conversations.some((each) => each.id === id)));
  return { ...state, conversations, events: kept(state.events), seqs: kept(state.seqs), waiting: kept(state.waiting) };
};

// What a conversation, or a turn, cost, as the agent reported it.
export function costLabel(of: { cost: Conversation['cost'] }) {
  if (of.cost === null) return null;
  return of.cost.currency === 'USD' ? `$${of.cost.amount.toFixed(2)}` : `${of.cost.amount.toFixed(2)} ${of.cost.currency}`;
}

export function durationLabel(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${String(seconds)}s` : `${String(Math.floor(seconds / 60))}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export const roleLabel = (role: Conversation['role']) => (role === 'author' ? 'Author' : 'Reviewer');

// When a conversation was last active: the time today, else the date too.
export function whenLabel(ms: number, now = Date.now()) {
  const date = new Date(ms);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  return sameDay ? date.toLocaleTimeString(undefined, { timeStyle: 'short' }) : date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}
