import type { Changes } from '../api/changes';

export type Leave = { branch: string; count: number };

// What to remind about when leaving a change request (LeaveNotice), from its
// last changes: its uncommitted files, or null when there is nothing to say.
export function leaveNotice(changes: Changes | null): Leave | null {
  if (changes?.branch == null || changes.files.length === 0) return null;
  return { branch: changes.branch, count: changes.files.length };
}
