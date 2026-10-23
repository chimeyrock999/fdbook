// What the server and the UI both say about agents and their conversations.
// No Node imports: the UI reads these types and the role list too.
import type { PermissionOption, SessionUpdate, ToolCallUpdate, Usage } from '@agentclientprotocol/sdk';

export type { PermissionOption, SessionUpdate, ToolCallUpdate, Usage };

export type AgentId = 'claude' | 'codex' | 'omp' | 'hermes';

export const AGENT_NAMES: Record<AgentId, string> = { claude: 'Claude Code', codex: 'Codex', omp: 'omp', hermes: 'Hermes Agent' };

// An author may change the change request's files; a reviewer only reads.
export type AgentRole = 'author' | 'reviewer';
export const AGENT_ROLES: AgentRole[] = ['author', 'reviewer'];

// Whether an agent can run on this machine, and why not. `note` is a
// warning that does not stop it (a tool the Studio would rather have off).
// `fencesReviewer`: its own tools can be held to reading for a reviewer;
// without it, the Studio rejects the edits and commands it asks about, and
// lists what it changed anyway.
export type AgentInfo = {
  id: AgentId;
  name: string;
  fencesReviewer: boolean;
  available: boolean;
  reason: string | null;
  note: string | null;
  version: string | null;
};

// A question nobody answers is rejected after this long, as the agent would on its own.
export const PERMISSION_TIMEOUT_MS = 5 * 60_000;

export type TurnStatus = 'running' | 'done' | 'cancelled' | 'failed';

export type Cost = { amount: number; currency: string };

// How a conversation's agent process came to its session: a new one for
// the first message; after the process stopped, the same one again
// (session/resume, or session/load), or a new one when the agent can do
// neither and remembers nothing of the earlier turns.
export type SessionStart = 'new' | 'resumed' | 'loaded' | 'fresh';

// One conversation with an agent: one ACP session, many turns. Agent and
// role are fixed for it.
export type Conversation = {
  id: string;
  agent: AgentId;
  agentName: string;
  role: AgentRole;
  // The first message.
  prompt: string;
  // The model the agent said it runs, when it says.
  model: string | null;
  // The turn going on, or else the last one.
  status: TurnStatus;
  error: string | null;
  startedMs: number;
  // When the last turn ended; null while one runs.
  endedMs: number | null;
  // The last message or end of a turn.
  lastMs: number;
  turns: number;
  // The agent's session, kept to resume it once the process has stopped.
  sessionId: string | null;
  // Whether its agent process is up (between turns too, until it idles out).
  live: boolean;
  // What its turns cost, as the agent reported; null when it reports none.
  cost: Cost | null;
  // The last turn's.
  usage: Usage | null;
  // Worktree paths it changed: written through the Studio, or by the
  // agent's own tools (seen in its tool calls, and in git status before and
  // after each turn, so an edit made by hand meanwhile counts too).
  writes: string[];
  // Who started it: a GitHub login, or null with sign-in off.
  by: string | null;
};

// How one turn ended, and the files it changed (`writes`: to keep or
// revert, turn by turn).
export type TurnEnd = { status: Exclude<TurnStatus, 'running'>; error: string | null; cost: Cost | null; usage: Usage | null; writes?: string[] };

// A file a turn changed, for Keep/Revert: whether it existed before the
// turn, whether a person kept or reverted the change, and why it cannot be
// reverted here (outside the notes, too large), or null.
export type TurnChange = { path: string; existed: boolean; decided: 'kept' | 'reverted' | null; reason: string | null };

// A change request's conversations, and what they cost by currency.
export type ConversationTotals = { conversations: number; costs: Record<string, number> };

// A question the agent asked before a tool call: the options are the
// agent's own, less any that would outlive the conversation.
export type PermissionAsk = { id: string; toolCall: ToolCallUpdate; options: PermissionOption[] };

// What a conversation records, in order, and what the event stream sends.
export type ConversationEvent =
  | { type: 'start'; at: number; conversation: Conversation }
  // The summary changed: the model named, a cost reported, the process gone.
  | { type: 'summary'; at: number; conversation: Conversation }
  // A message from a person: a turn begins.
  | { type: 'turn'; at: number; prompt: string; by: string | null }
  // An agent process took up the session.
  | { type: 'session'; at: number; how: SessionStart; sessionId: string }
  | { type: 'update'; at: number; update: SessionUpdate }
  | { type: 'permission'; at: number; ask: PermissionAsk }
  // `optionId` null: rejected, by a person or because nobody answered in time.
  | { type: 'answer'; at: number; id: string; optionId: string | null; by: string | null }
  | { type: 'write'; at: number; path: string; bytes: number }
  // Files the agent changed with its own tools.
  | { type: 'changed'; at: number; paths: string[] }
  // An edit it proposed (propose_edit, or a write to a note): `hunks` wait for a person.
  | { type: 'proposal'; at: number; id: string; path: string; hunks: number }
  // A turn ended.
  | { type: 'end'; at: number; conversation: Conversation; turn: TurnEnd };

// The summary an event carries, if any.
export const summaryOf = (event: ConversationEvent) => (event.type === 'start' || event.type === 'summary' || event.type === 'end' ? event.conversation : null);

// A conversation's summary and events as read, and `seq`: how many events
// it has recorded, to place the stream's next ones after it.
export type ConversationRead = { conversation: Conversation; events: ConversationEvent[]; seq: number };

// The workspace's stream: each event with its conversation and its number
// there (`seq`, from 1). Only on the stream: `deleted`, when a conversation
// is deleted, `decided` for Keep/Revert, and on connecting, a `snapshot` of
// each one with a turn going on.
export type StreamEvent =
  | (ConversationEvent & { conversationId: string; seq: number })
  | { type: 'deleted'; at: number; conversationId: string }
  // A person kept or reverted a file a turn changed.
  | { type: 'decided'; at: number; conversationId: string; turn: number; path: string; decided: 'kept' | 'reverted' }
  | ({ type: 'snapshot'; at: number; conversationId: string } & ConversationRead);
