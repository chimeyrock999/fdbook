import type { Changes } from '#api/changes.ts';
import { keepInTab, keptInTab } from '#session-storage.ts';

// A change request left with uncommitted files: its slug (to go back), its
// branch and how many files.
export type Leave = { cr: string; branch: string; count: number };

const STORAGE_KEY = 'notes-studio:left-cr';

// What to remind about when leaving change request `cr` (LeaveNotice), from
// its last changes, or null when there is nothing to say (main, or nothing
// uncommitted).
export function leaveNotice(changes: Changes | null, cr: string | null): Leave | null {
  if (cr === null || changes?.branch == null || changes.files.length === 0) return null;
  return { cr, branch: changes.branch, count: changes.files.length };
}

// Switching change requests loads the page again (src/api/workspace.ts), so
// the reminder is kept for the next page to show. Losing it (storage off)
// only loses the reminder.
export function rememberLeave(leave: Leave | null) {
  keepInTab(STORAGE_KEY, leave);
}

// The reminder the last page left, unless it is about the change request
// this page opens (the user went back).
export function leftBehind(current: string | null): Leave | null {
  const value = keptInTab(STORAGE_KEY) as Partial<Leave> | null;
  if (typeof value?.cr !== 'string' || typeof value.branch !== 'string' || typeof value.count !== 'number' || value.cr === current) return null;
  return { cr: value.cr, branch: value.branch, count: value.count };
}
