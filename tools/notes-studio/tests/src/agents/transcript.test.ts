import { describe, expect, it } from 'vitest';
import type { Conversation, ConversationEvent, StreamEvent } from '../../../src/api/agents';
import { costLabel, decisionKey, durationLabel, EMPTY_CONVERSATIONS, firstAsk, openAsks, reading, transcriptOf, unheld, unread, withEvent, withList, withRead } from '../../../src/agents/transcript';
import { pickOf } from '../../../src/agents/useAgents';

const summary = (change: Partial<Conversation> = {}): Conversation => ({
  id: 'r1', agent: 'claude', agentName: 'Claude Code', role: 'author', prompt: 'Tighten the intro', model: null, status: 'running', error: null,
  startedMs: 1000, endedMs: null, lastMs: 1000, turns: 1, sessionId: null, live: true, cost: null, usage: null, writes: [], by: null, ...change,
});
const text = (kind: 'agent_message_chunk' | 'agent_thought_chunk', value: string): ConversationEvent => ({ type: 'update', at: 1, update: { sessionUpdate: kind, content: { type: 'text', text: value } } });
const ask = { id: 'a1', toolCall: { toolCallId: 't1', title: 'Run npm test' }, options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' as const }] };

describe('agent transcripts', () => {
  it('joins text chunks, keeps one entry per tool call and plan, and pairs questions with answers', () => {
    const items = transcriptOf([
      { type: 'start', at: 0, conversation: summary() },
      text('agent_thought_chunk', 'Reading '),
      text('agent_thought_chunk', 'the note'),
      { type: 'update', at: 1, update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read intro.mdx', kind: 'read', status: 'pending' } },
      { type: 'update', at: 1, update: { sessionUpdate: 'plan', entries: [{ content: 'Read', status: 'in_progress', priority: 'medium' }] } },
      { type: 'update', at: 2, update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', title: null } },
      { type: 'update', at: 2, update: { sessionUpdate: 'plan', entries: [{ content: 'Read', status: 'completed', priority: 'medium' }] } },
      { type: 'permission', at: 3, ask },
      { type: 'answer', at: 4, id: 'a1', optionId: 'ok', by: 'octocat' },
      { type: 'write', at: 5, path: 'content/notes/intro.mdx', bytes: 12 },
      text('agent_message_chunk', 'Done, '),
      text('agent_message_chunk', 'shorter now.'),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['thought', 'tool', 'plan', 'ask', 'write', 'message']);
    expect(items[0]).toMatchObject({ text: 'Reading the note' });
    expect(items[1]).toMatchObject({ call: { title: 'Read intro.mdx', status: 'completed', kind: 'read' } });
    expect(items[2]).toMatchObject({ entries: [{ status: 'completed' }] });
    expect(items[3]).toMatchObject({ answer: { optionId: 'ok', by: 'octocat' } });
    expect(items[5]).toMatchObject({ text: 'Done, shorter now.' });
  });

  it('marks each turn with its message and its end, and a session taken up again', () => {
    const items = transcriptOf([
      { type: 'start', at: 0, conversation: summary() },
      { type: 'turn', at: 0, prompt: 'First', by: 'octocat' },
      { type: 'session', at: 1, how: 'new', sessionId: 's1' },
      text('agent_message_chunk', 'One.'),
      { type: 'end', at: 2000, conversation: summary({ status: 'done' }), turn: { status: 'done', error: null, cost: { amount: 0.12, currency: 'USD' }, usage: null } },
      { type: 'turn', at: 10_000, prompt: 'Second', by: null },
      { type: 'session', at: 10_001, how: 'resumed', sessionId: 's1' },
      text('agent_message_chunk', 'Two.'),
      { type: 'end', at: 75_000, conversation: summary({ status: 'failed' }), turn: { status: 'failed', error: 'boom', cost: null, usage: null } },
    ]);
    expect(items.map((item) => item.kind)).toEqual(['prompt', 'message', 'turn-end', 'prompt', 'session', 'message', 'turn-end']);
    expect(items[0]).toMatchObject({ text: 'First', by: 'octocat' });
    expect(items[2]).toMatchObject({ index: 1, ms: 2000, turn: { status: 'done' } });
    expect(items[4]).toMatchObject({ how: 'resumed' });
    expect(items[6]).toMatchObject({ index: 2, ms: 65_000, turn: { error: 'boom' } });
  });

  it('finds the questions still open, oldest asked first', () => {
    const asked: ConversationEvent[] = [{ type: 'permission', at: 7, ask }];
    expect(openAsks(asked)).toEqual([ask]);
    expect(openAsks([...asked, { type: 'answer', at: 8, id: 'a1', optionId: null, by: null }])).toEqual([]);
    const older = summary({ id: 'old', startedMs: 1 });
    const newer = summary({ id: 'new', startedMs: 2 });
    expect(firstAsk([newer, older], { new: asked, old: [{ type: 'permission', at: 3, ask: { ...ask, id: 'a0' } }] })).toMatchObject({ conversation: { id: 'old' }, ask: { id: 'a0' }, at: 3 });
    expect(firstAsk([newer], {})).toBeNull();
  });

  it('folds streamed events in, starting afresh on a start, skipping one it has by seq', () => {
    const start: StreamEvent = { type: 'start', at: 0, conversation: summary(), conversationId: 'r1', seq: 1 };
    let state = withEvent(EMPTY_CONVERSATIONS, start);
    const hi: StreamEvent = { ...text('agent_message_chunk', 'hi'), conversationId: 'r1', seq: 2 };
    state = withEvent(state, hi);
    state = withEvent(state, hi);
    expect(state.events.r1).toHaveLength(2);
    state = withEvent(state, start);
    expect(state.events.r1).toHaveLength(1);
    const turn = { status: 'done' as const, error: null, cost: null, usage: null };
    state = withEvent(state, { type: 'end', at: 9, conversation: summary({ status: 'done', endedMs: 9 }), turn, conversationId: 'r1', seq: 3 });
    expect(state.conversations).toEqual([summary({ status: 'done', endedMs: 9 })]);
  });

  it('holds no events of a chat it has not read, only its summary, and says to read it', () => {
    let state = withList(EMPTY_CONVERSATIONS, [summary({ id: 'old', status: 'done' })]);
    const turn: StreamEvent = { type: 'turn', at: 5, prompt: 'Again', by: null, conversationId: 'old', seq: 7 };
    expect(unheld(state, turn)).toBe(true);
    state = withEvent(state, turn);
    expect(state.events.old).toBeUndefined();
    state = withEvent(state, { type: 'summary', at: 5, conversation: summary({ id: 'old', turns: 2, lastMs: 5 }), conversationId: 'old', seq: 8 });
    expect(state.conversations[0]).toMatchObject({ id: 'old', turns: 2 });
    expect(unheld(reading(state, 'old'), turn)).toBe(false);
  });

  it('keeps the stream\'s events that come while a chat is read, newer than the read', () => {
    let state = reading(EMPTY_CONVERSATIONS, 'c');
    const ask = { id: 'a1', toolCall: { toolCallId: 't1', title: 'Run npm test' }, options: [] };
    state = withEvent(state, { type: 'turn', at: 5, prompt: 'Again', by: null, conversationId: 'c', seq: 3 });
    state = withEvent(state, { type: 'permission', at: 6, ask, conversationId: 'c', seq: 4 });
    // The read holds three events: the turn came before it was taken, the question after.
    state = withRead(state, 'c', { conversation: summary({ id: 'c' }), seq: 3, events: [{ type: 'start', at: 0, conversation: summary({ id: 'c' }) }, text('agent_message_chunk', 'one'), { type: 'turn', at: 5, prompt: 'Again', by: null }] });
    expect(state.events.c.map((event) => event.type)).toEqual(['start', 'update', 'turn', 'permission']);
    expect(state.seqs.c).toBe(4);
    expect(state.waiting).toEqual({});
    expect(openAsks(state.events.c)).toEqual([ask]);
    // Read again after a reconnect: what came meanwhile waits too.
    state = reading(state, 'c');
    state = withEvent(state, { type: 'answer', at: 7, id: 'a1', optionId: null, by: null, conversationId: 'c', seq: 5 });
    expect(state.events.c).toHaveLength(4);
    state = unread(state, 'c');
    expect(state.events.c).toHaveLength(4);
  });

  it('counts Keep/Revert decisions per turn, so its list is read again', () => {
    let state = withEvent(EMPTY_CONVERSATIONS, { type: 'decided', at: 1, conversationId: 'c', turn: 2, path: 'a.mdx', decided: 'kept' });
    state = withEvent(state, { type: 'decided', at: 2, conversationId: 'c', turn: 2, path: 'b.mdx', decided: 'reverted' });
    expect(state.decisions).toEqual({ [decisionKey('c', 2)]: 2 });
    expect(unheld(state, { type: 'decided', at: 3, conversationId: 'x', turn: 1, path: 'a.mdx', decided: 'kept' })).toBe(false);
  });

  it('takes a snapshot on a reconnect as the whole chat, and forgets a deleted one', () => {
    let state = withEvent(EMPTY_CONVERSATIONS, { type: 'snapshot', at: 1, conversationId: 'c', conversation: summary({ id: 'c' }), seq: 2, events: [{ type: 'start', at: 0, conversation: summary({ id: 'c' }) }, text('agent_message_chunk', 'one')] });
    expect(state.events.c).toHaveLength(2);
    expect(state.conversations.map((each) => each.id)).toEqual(['c']);
    state = withEvent(state, { type: 'deleted', at: 6, conversationId: 'c' });
    expect(state).toEqual(EMPTY_CONVERSATIONS);
  });

  it('keeps a chat whose agent is answering that the list does not have yet, last active first', () => {
    const state = withEvent(EMPTY_CONVERSATIONS, { type: 'start', at: 0, conversation: summary({ id: 'live', lastMs: 5 }), conversationId: 'live', seq: 1 });
    expect(withList(state, [summary({ id: 'old', lastMs: 1, status: 'done' })]).conversations.map((each) => each.id)).toEqual(['live', 'old']);
  });

  it('labels cost and duration', () => {
    expect(costLabel({ cost: null })).toBeNull();
    expect(costLabel({ cost: { amount: 0.314, currency: 'USD' } })).toBe('$0.31');
    expect(costLabel({ cost: { amount: 2, currency: 'EUR' } })).toBe('2.00 EUR');
    expect(durationLabel(9_400)).toBe('9s');
    expect(durationLabel(161_000)).toBe('2m 41s');
  });

  it('runs the agent picked for a role, or the first that can run, and another one for review', () => {
    const agents = [
      { id: 'claude' as const, name: 'Claude Code', fencesReviewer: true, available: true, reason: null, note: null, version: '1' },
      { id: 'codex' as const, name: 'Codex', fencesReviewer: true, available: true, reason: null, note: null, version: '1' },
      { id: 'hermes' as const, name: 'Hermes Agent', fencesReviewer: false, available: false, reason: 'not installed', note: null, version: null },
    ];
    expect(pickOf(agents, { author: null, reviewer: null }, 'author')?.id).toBe('claude');
    expect(pickOf(agents, { author: null, reviewer: null }, 'reviewer')?.id).toBe('codex');
    expect(pickOf(agents, { author: 'codex', reviewer: null }, 'reviewer')?.id).toBe('claude');
    expect(pickOf(agents, { author: 'hermes', reviewer: 'hermes' }, 'author')?.id).toBe('claude');
    expect(pickOf(null, { author: null, reviewer: null }, 'author')).toBeNull();
  });
});
