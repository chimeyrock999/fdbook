// A run's events as the agent panel shows them: the agent's text and
// thoughts joined into paragraphs, each tool call once with its latest state,
// the latest plan, questions with their answers, and the files written.

import type { PermissionAsk, RunEvent, StreamEvent, ToolCallUpdate } from '../../server/agents/shared';
import type { RunSummary } from '../api/agents';

export type PlanEntry = { content: string; status: 'pending' | 'in_progress' | 'completed' };

export type TranscriptItem =
  | { kind: 'message'; key: string; text: string }
  | { kind: 'thought'; key: string; text: string }
  | { kind: 'tool'; key: string; call: ToolCallUpdate }
  | { kind: 'plan'; key: string; entries: PlanEntry[] }
  | { kind: 'ask'; key: string; ask: PermissionAsk; answer: { optionId: string | null; by: string | null } | null }
  | { kind: 'write'; key: string; path: string }
  | { kind: 'proposal'; key: string; path: string; hunks: number }

export function transcriptOf(events: RunEvent[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const tools = new Map<string, Extract<TranscriptItem, { kind: 'tool' }>>();
  const asks = new Map<string, Extract<TranscriptItem, { kind: 'ask' }>>();
  let plan: Extract<TranscriptItem, { kind: 'plan' }> | null = null;
  // Chunks of one kind in a row make one paragraph.
  const append = (kind: 'message' | 'thought', text: string) => {
    const last = items.at(-1);
    if (last?.kind === kind) last.text += text;
    else items.push({ kind, key: `${kind}-${String(items.length)}`, text });
  };

  for (const event of events) {
    if (event.type === 'permission') {
      const item = { kind: 'ask' as const, key: `ask-${event.ask.id}`, ask: event.ask, answer: null };
      asks.set(event.ask.id, item);
      items.push(item);
    } else if (event.type === 'answer') {
      const item = asks.get(event.id);
      if (item) item.answer = { optionId: event.optionId, by: event.by };
    } else if (event.type === 'write') items.push({ kind: 'write', key: `write-${String(items.length)}`, path: event.path });
    else if (event.type === 'proposal') items.push({ kind: 'proposal', key: `proposal-${event.id}`, path: event.path, hunks: event.hunks });
    else if (event.type === 'changed') for (const path of event.paths) items.push({ kind: 'write', key: `write-${String(items.length)}`, path });
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
        // One plan, where it first showed, kept up to date.
        if (plan === null) {
          plan = { kind: 'plan', key: 'plan', entries: update.entries };
          items.push(plan);
        } else plan.entries = update.entries;
      }
    }
  }
  return items;
}

// A tool call update leaves out (or nulls) what did not change.
function withoutNulls(update: ToolCallUpdate & { sessionUpdate?: string }): ToolCallUpdate {
  return Object.fromEntries(Object.entries(update).filter(([key, value]) => key !== 'sessionUpdate' && value !== null && value !== undefined)) as ToolCallUpdate;
}

// The questions of a run still waiting for an answer.
export function openAsks(events: RunEvent[]): PermissionAsk[] {
  const answered = new Set(events.flatMap((event) => (event.type === 'answer' ? [event.id] : [])));
  return events.flatMap((event) => (event.type === 'permission' && !answered.has(event.ask.id) ? [event.ask] : []));
}

// The first question waiting for an answer among `runs`, oldest first, with its run.
export function firstAsk(runs: RunSummary[], events: Record<string, RunEvent[] | undefined>) {
  for (const run of [...runs].sort((a, b) => a.startedMs - b.startedMs)) {
    const runEvents = events[run.id] ?? [];
    const ask = openAsks(runEvents).at(0);
    if (ask !== undefined) {
      const at = runEvents.find((event) => event.type === 'permission' && event.ask.id === ask.id)?.at ?? Date.now();
      return { run, ask, at };
    }
  }
  return null;
}

export type RunsState = { runs: RunSummary[]; events: Record<string, RunEvent[]> };

export const EMPTY_RUNS: RunsState = { runs: [], events: {} };

// Folds one streamed event in. A start (sent again on a reconnect for the
// runs going on) begins the run's events afresh, so nothing doubles.
export function withEvent(state: RunsState, event: StreamEvent): RunsState {
  const { runId, ...rest } = event;
  const recorded: RunEvent = rest;
  const events = recorded.type === 'start' ? [recorded] : [...(state.events[runId] ?? []), recorded];
  const summary = recorded.type === 'start' || recorded.type === 'summary' || recorded.type === 'end' ? recorded.run : null;
  const runs = summary === null ? state.runs : [summary, ...state.runs.filter((run) => run.id !== runId)].sort((a, b) => b.startedMs - a.startedMs);
  return { runs, events: { ...state.events, [runId]: events } };
}

// The runs as listed by the server, keeping the events already streamed.
export const withList = (state: RunsState, runs: RunSummary[]): RunsState => {
  const live = state.runs.filter((run) => run.status === 'running' && !runs.some((listed) => listed.id === run.id));
  return { ...state, runs: [...live, ...runs].sort((a, b) => b.startedMs - a.startedMs) };
};

// What a run cost, as the agent reported it.
export function costLabel(run: Pick<RunSummary, 'cost'>) {
  if (run.cost === null) return null;
  return run.cost.currency === 'USD' ? `$${run.cost.amount.toFixed(2)}` : `${run.cost.amount.toFixed(2)} ${run.cost.currency}`;
}

export function durationLabel(run: Pick<RunSummary, 'startedMs' | 'endedMs'>, now = Date.now()) {
  const seconds = Math.max(0, Math.round(((run.endedMs ?? now) - run.startedMs) / 1000));
  return seconds < 60 ? `${String(seconds)}s` : `${String(Math.floor(seconds / 60))}m ${String(seconds % 60).padStart(2, '0')}s`;
}
