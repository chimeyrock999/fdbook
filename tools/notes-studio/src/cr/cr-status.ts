import type { ChangeRequest, CrStatus } from '../api/crs';

export const STATUS_LABELS: Record<CrStatus, string> = {
  draft: 'Draft',
  previewing: 'Previewing',
  review: 'In review',
  merged: 'Merged',
  closed: 'Closed',
};

// Still being edited or reviewed: the ones Edit offers to continue in.
export const isOpen = (cr: ChangeRequest) => cr.status === 'draft' || cr.status === 'previewing' || cr.status === 'review';

// The list's groups, in order.
export const GROUPS: { title: string; statuses: readonly CrStatus[]; empty: string }[] = [
  { title: 'In progress', statuses: ['draft', 'previewing'], empty: 'No change request in progress.' },
  { title: 'Waiting to merge', statuses: ['review'], empty: 'No pull request waiting.' },
  { title: 'To clean up', statuses: ['merged', 'closed'], empty: 'Nothing to clean up.' },
];

// Merged or closed: what is left is to clean it up.
export const isDone = (cr: { status: CrStatus }) => cr.status === 'merged' || cr.status === 'closed';

// A note's path as the list shows it, without content/notes/.
export const shortPath = (path: string) => path.replace(/^content\/notes\//, '');

// Days since `ms`, whole.
export const daysSince = (ms: number, now = Date.now()) => Math.floor((now - ms) / (24 * 3600_000));

// A path as a shell reads it: quoted when it holds anything but plain characters.
export const shellPath = (path: string) => (/^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`);

// The command that brings main into the change request, run in a terminal (v1).
export const mergeCommand = (worktree: string) => `cd ${shellPath(worktree)} && git merge origin/main`;

export const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? '' : 's'}`;

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600_000],
  ['month', 30 * 24 * 3600_000],
  ['week', 7 * 24 * 3600_000],
  ['day', 24 * 3600_000],
  ['hour', 3600_000],
  ['minute', 60_000],
];

// "5 minutes ago", "yesterday"; "just now" under a minute.
export function updatedAgo(ms: number, now = Date.now()) {
  const elapsed = now - ms;
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of UNITS) if (elapsed >= size) return format.format(-Math.floor(elapsed / size), unit);
  return 'just now';
}
