import { describe, expect, it } from 'vitest';
import type { RunEvent, RunSummary, StreamEvent } from '../../../src/api/agents';
import { costLabel, durationLabel, EMPTY_RUNS, firstAsk, openAsks, transcriptOf, withEvent, withList } from '../../../src/agents/transcript';
import { pickOf } from '../../../src/agents/useAgents';

const summary = (change: Partial<RunSummary> = {}): RunSummary => ({
  id: 'r1', agent: 'claude', agentName: 'Claude Code', role: 'author', prompt: 'Tighten the intro', model: null, status: 'running', error: null,
  startedMs: 1000, endedMs: null, cost: null, usage: null, writes: [], by: null, ...change,
});
const text = (kind: 'agent_message_chunk' | 'agent_thought_chunk', value: string): RunEvent => ({ type: 'update', at: 1, update: { sessionUpdate: kind, content: { type: 'text', text: value } } });
const ask = { id: 'a1', toolCall: { toolCallId: 't1', title: 'Run npm test' }, options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' as const }] };

describe('agent transcripts', () => {
  it('joins text chunks, keeps one entry per tool call and plan, and pairs questions with answers', () => {
    const items = transcriptOf([
      { type: 'start', at: 0, run: summary() },
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

  it('finds the questions still open, oldest run first', () => {
    const asked: RunEvent[] = [{ type: 'permission', at: 7, ask }];
    expect(openAsks(asked)).toEqual([ask]);
    expect(openAsks([...asked, { type: 'answer', at: 8, id: 'a1', optionId: null, by: null }])).toEqual([]);
    const older = summary({ id: 'old', startedMs: 1 });
    const newer = summary({ id: 'new', startedMs: 2 });
    expect(firstAsk([newer, older], { new: asked, old: [{ type: 'permission', at: 3, ask: { ...ask, id: 'a0' } }] })).toMatchObject({ run: { id: 'old' }, ask: { id: 'a0' }, at: 3 });
    expect(firstAsk([newer], {})).toBeNull();
  });

  it('folds streamed events in, starting afresh on a start sent again after a reconnect', () => {
    const start: StreamEvent = { type: 'start', at: 0, run: summary(), runId: 'r1' };
    let state = withEvent(EMPTY_RUNS, start);
    state = withEvent(state, { ...text('agent_message_chunk', 'hi'), runId: 'r1' });
    expect(state.events.r1).toHaveLength(2);
    state = withEvent(state, start);
    expect(state.events.r1).toHaveLength(1);
    state = withEvent(state, { type: 'end', at: 9, run: summary({ status: 'done', endedMs: 9 }), runId: 'r1' });
    expect(state.runs).toEqual([summary({ status: 'done', endedMs: 9 })]);
  });

  it('keeps a run going on that the list does not have yet, newest first', () => {
    const state = withEvent(EMPTY_RUNS, { type: 'start', at: 0, run: summary({ id: 'live', startedMs: 5 }), runId: 'live' });
    expect(withList(state, [summary({ id: 'old', startedMs: 1, status: 'done' })]).runs.map((run) => run.id)).toEqual(['live', 'old']);
  });

  it('labels cost and duration', () => {
    expect(costLabel({ cost: null })).toBeNull();
    expect(costLabel({ cost: { amount: 0.314, currency: 'USD' } })).toBe('$0.31');
    expect(costLabel({ cost: { amount: 2, currency: 'EUR' } })).toBe('2.00 EUR');
    expect(durationLabel({ startedMs: 0, endedMs: 9_400 })).toBe('9s');
    expect(durationLabel({ startedMs: 0, endedMs: 161_000 })).toBe('2m 41s');
    expect(durationLabel({ startedMs: 0, endedMs: null }, 5_000)).toBe('5s');
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
