import { HttpError } from '#infra/http.ts';
import type { AgentProfile } from './profiles.ts';
import { mainRefusal, type AgentRole } from '@fdbook/shared/agents.ts';

// What holds an agent on main to reading. Only an agent whose own tools
// can be held to reading runs there (`fencesReviewer`: Claude Code,
// Codex); omp and Hermes could write anywhere their user can, and move
// branches through git, whatever folder they start in. The role a person
// picks (author, reviewer) shapes what the agent is told, never what it
// may do: it runs fenced as a reviewer everywhere (its tools, ACP writes,
// the questions it asks, the Studio's MCP tools). It starts in a copy of
// main (services/cr/manager.ts), scratch space that keeps main's own folder out
// of the way of what it tries.
export const fencedRole = (readOnly: boolean, role: AgentRole): AgentRole => (readOnly ? 'reviewer' : role);

// The Studio's line after each message on main. One line: the fake agent
// of the tests reads a prompt line by line.
export function mainNote(role: AgentRole) {
  const ask = role === 'author'
    ? 'When the person asks for a change, call the create_cr tool with a short name and a brief (what to change, where, why): the Studio opens a change request and starts an author chat there with your brief.'
    : 'Review and answer; when a change is needed, say what, and call create_cr only if the person asks for it.';
  return `\n\n---\nNotes Studio: this chat is on main, which is read only. Read, search and answer; edits, commands and writes are refused here. ${ask}`;
}

// Refuses an agent main cannot hold to reading.
export function checkOnMain(profile: AgentProfile) {
  const refusal = mainRefusal(profile);
  if (refusal !== null) throw new HttpError(409, refusal);
}

// Keep/Revert has nothing to act on: a turn on main changes no file.
function refuseChanges(): never {
  throw new HttpError(409, 'main is read only: its chats change no files');
}

// In place of the turns' changes (services/agents/chat/turn-changes.ts) on main.
export const refusedChanges = { changes: refuseChanges, before: refuseChanges, decide: refuseChanges, draft: () => Promise.resolve(false) };
