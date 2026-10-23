// What the server and the UI both say about agents and their runs. No Node
// imports: the UI reads these types and the role list too.
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

export type RunStatus = 'running' | 'done' | 'cancelled' | 'failed';

export type Cost = { amount: number; currency: string };

export type RunSummary = {
  id: string;
  agent: AgentId;
  agentName: string;
  role: AgentRole;
  prompt: string;
  // The model the agent said it runs, when it says.
  model: string | null;
  status: RunStatus;
  error: string | null;
  startedMs: number;
  endedMs: number | null;
  // The agent's own figure; null when it reports none.
  cost: Cost | null;
  usage: Usage | null;
  // Worktree paths the run changed: written through the Studio, or by the
  // agent's own tools (seen in its tool calls, and in git status before and
  // after the run, so an edit made by hand meanwhile counts too).
  writes: string[];
  // Who started it: a GitHub login, or null with sign-in off.
  by: string | null;
};

// A file a run changed, for Keep/Revert: whether it existed before the
// run, whether a person kept or reverted the change, and why it cannot be
// reverted here (outside the notes, too large), or null.
export type RunChange = { path: string; existed: boolean; decided: 'kept' | 'reverted' | null; reason: string | null };

// A change request's runs, and what they cost by currency.
export type RunTotals = { runs: number; costs: Record<string, number> };

// A question the agent asked before a tool call: the options are the
// agent's own, less any that would outlive the run.
export type PermissionAsk = { id: string; toolCall: ToolCallUpdate; options: PermissionOption[] };

// What a run records, in order, and what the event stream sends.
export type RunEvent =
  | { type: 'start'; at: number; run: RunSummary }
  // The summary changed while running: the model named, a cost reported.
  | { type: 'summary'; at: number; run: RunSummary }
  | { type: 'update'; at: number; update: SessionUpdate }
  | { type: 'permission'; at: number; ask: PermissionAsk }
  // `optionId` null: rejected, by a person or because nobody answered in time.
  | { type: 'answer'; at: number; id: string; optionId: string | null; by: string | null }
  | { type: 'write'; at: number; path: string; bytes: number }
  // Files the agent changed with its own tools.
  | { type: 'changed'; at: number; paths: string[] }
  // An edit it proposed (propose_edit, or a write to a note): `hunks` wait for a person.
  | { type: 'proposal'; at: number; id: string; path: string; hunks: number }
  | { type: 'end'; at: number; run: RunSummary };

// One event of the workspace's stream: which run it belongs to.
export type StreamEvent = RunEvent & { runId: string };
