import { HttpError } from '../http.ts';
import type { AgentRole } from './shared.ts';

// What holds an agent on main to reading. The role a person picks there
// (author, reviewer) shapes what the agent is told, never what it may do:
// it runs fenced as a reviewer everywhere (its tools, ACP writes, the
// questions it asks, the Studio's MCP tools), in a copy of main reset
// before each turn (cr/manager.ts), so even an agent whose own tools write
// without asking leaves main as it was.
export const fencedRole = (readOnly: boolean, role: AgentRole): AgentRole => (readOnly ? 'reviewer' : role);

// The Studio's line after each message on main. One line: the fake agent
// of the tests reads a prompt line by line.
export function mainNote(role: AgentRole) {
  const ask = role === 'author'
    ? 'When the person asks for a change, call the create_cr tool with a short name and a brief (what to change, where, why): the Studio opens a change request and starts an author chat there with your brief.'
    : 'Review and answer; when a change is needed, say what, and call create_cr only if the person asks for it.';
  return `\n\n---\nNotes Studio: this chat is on main, which is read only. Read, search and answer; edits, commands and writes are refused here. ${ask}`;
}

// Keep/Revert has nothing to act on: a turn on main changes no file.
export function refuseChanges(): never {
  throw new HttpError(409, 'main is read only: its chats change no files');
}
