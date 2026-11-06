import { act } from '@testing-library/react';
import { ToastStack } from '#actions/ToastStack.tsx';
import { vi } from 'vitest';
import { AgentControl } from '#agents/AgentControl.tsx';
import { AgentPanel } from '#agents/AgentPanel.tsx';
import { useAgents } from '#agents/useAgents.ts';
import { useAsking } from '#agents/useAsking.ts';
import type { AgentInfo, AgentsClient, Attachment, Conversation, ConversationRead, Mention, StreamEvent, TurnChange } from '#api/agents.ts';

export const AGENTS: AgentInfo[] = [
  { id: 'claude', name: 'Claude Code', fencesReviewer: true, available: true, reason: null, note: null, version: '0.88.0' },
  { id: 'codex', name: 'Codex', fencesReviewer: true, available: true, reason: null, note: null, version: '2.2.2' },
  { id: 'omp', name: 'omp', fencesReviewer: false, available: true, reason: null, note: null, version: '18.5.1' },
  { id: 'hermes', name: 'Hermes Agent', fencesReviewer: false, available: false, reason: 'hermes is not installed: install Hermes Agent with its [acp] extra', note: null, version: null },
];

// What the fake client finds to mention.
export const MENTIONS: Mention[] = [
  { kind: 'note', path: 'content/docs/guide/first-look.mdx' },
  { kind: 'asset', path: 'public/docs/guide/chart.png' },
  { kind: 'file', path: 'lib/helper.ts' },
];

export const summary = (change: Partial<Conversation> = {}): Conversation => ({
  id: 'c1', agent: 'claude', agentName: 'Claude Code', role: 'author', prompt: 'Tighten the intro', model: 'Opus 5.5', status: 'running', error: null,
  startedMs: Date.now(), endedMs: null, lastMs: Date.now(), turns: 1, sessionId: 's1', live: true, cost: null, usage: null, writes: [], by: 'octocat', ...change,
});

// A stream event as a test writes it: `emit` numbers it when it has no `seq`.
type Emitted = StreamEvent extends infer Each ? (Each extends { seq: number } ? Omit<Each, 'seq'> & { seq?: number } : Each) : never;

// A client whose stream the test drives (`emit`, `reconnect`).
export function fakeClient(conversations: Conversation[] = [], changes: TurnChange[] = []) {
  let listener: ((event: StreamEvent) => void) | null = null;
  let seq = 0;
  let opened: () => void = () => undefined;
  const client = {
    agents: vi.fn(() => Promise.resolve(AGENTS)),
    totals: vi.fn(() => Promise.resolve({})),
    conversations: vi.fn(() => Promise.resolve(conversations)),
    start: vi.fn((agent: string, role: string, prompt: string) => Promise.resolve(summary({ id: 'new', agent: agent as Conversation['agent'], role: role as Conversation['role'], prompt }))),
    message: vi.fn((id: string) => Promise.resolve(summary({ id, turns: 2 }))),
    read: vi.fn((id: string): Promise<ConversationRead> => Promise.resolve({ conversation: conversations.find((each) => each.id === id) ?? summary({ id }), events: [], seq: 0 })),
    remove: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(() => Promise.resolve()),
    answer: vi.fn(() => Promise.resolve()),
    changes: vi.fn((): Promise<TurnChange[]> => Promise.resolve(changes)),
    // A revert of content/docs/late.mdx fails: a later edit changed it.
    decide: vi.fn((_id: string, _turn: number, path: string, op: 'keep' | 'revert') => (path === 'content/docs/late.mdx' && op === 'revert' ? Promise.reject(new Error('content/docs/late.mdx changed since the turn ended')) : Promise.resolve({ path, existed: true, decided: op === 'keep' ? 'kept' as const : 'reverted' as const, reason: null }))),
    compare: vi.fn(() => Promise.resolve({ before: 'Before.\n', after: 'After.\n' })),
    mentions: vi.fn((query: string): Promise<Mention[]> => Promise.resolve(MENTIONS.filter((mention) => mention.path.includes(query)))),
    attach: vi.fn((file: File): Promise<Attachment> => Promise.resolve({ id: `a${String(file.size)}`, name: file.name, size: file.size })),
    subscribe: vi.fn((next: (event: StreamEvent) => void, onOpen: () => void = () => undefined) => {
      listener = next;
      opened = onOpen;
      onOpen();
      return () => { listener = null; };
    }),
  } satisfies AgentsClient;
  const emit = (event: Emitted) => {
    seq += 1;
    const numbered = (event.type === 'deleted' || event.type === 'snapshot' ? event : { seq, ...event }) as StreamEvent;
    act(() => { listener?.(numbered); });
  };
  // The stream connects again, after missing what happened meanwhile.
  const reconnect = () => { act(() => { opened(); }); };
  return { client, emit, reconnect };
}

export function Harness({ client, inCr = true, canRun = true, onOpenDiff = () => undefined, onOpenNote = () => undefined }: { client: AgentsClient; inCr?: boolean; canRun?: boolean; onOpenDiff?: (path: string) => void; onOpenNote?: (path: string) => void }) {
  // As the app: chats on main too (`inCr` false).
  const agents = useAgents(client, true, !inCr);
  const live = agents.conversations.filter((conversation) => conversation.status === 'running').length;
  const { asking, asks } = useAsking(agents, canRun);
  return (
    <>
      <AgentControl agents={agents} live={live} asks={asks} />
      {agents.open && <AgentPanel agents={agents} inCr={inCr} canRun={canRun} canDecide asking={asking} onOpenDiff={onOpenDiff} onOpenNote={onOpenNote} />}
      <ToastStack />
    </>
  );
}
