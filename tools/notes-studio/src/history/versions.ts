import { NOW, type PageHistory } from '../api/history';

// The versions a history page lists, newest first: Now (the page on disk,
// committed or not) when the worktree is editable and still has the page,
// then each commit that changed it.
export function versionIds(history: PageHistory, withNow: boolean): string[] {
  const shas = history.versions.map((version) => version.sha);
  return withNow && history.mtimeMs !== null ? [NOW, ...shas] : shas;
}

// What `selected` is compared with: `against` when it is another listed
// version, else the version before it (null for the first one: nothing).
export function comparedWith(ids: readonly string[], selected: string, against: string | null): string | null {
  if (against !== null && against !== selected && ids.includes(against)) return against;
  return ids[ids.indexOf(selected) + 1] ?? null;
}

export const shortVersion = (version: string) => (version === NOW ? 'Now' : version.slice(0, 7));

export const fileNameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

// Why Restore is off for `selected`, or null when it is on. `reader`: the
// signed-in person may read but not write (#99).
export function restoreBlocked({ selected, readOnly, reader = false, mtimeMs }: { selected: string; readOnly: boolean; reader?: boolean; mtimeMs: number | null }) {
  if (reader) return 'Restoring needs write access to the repository; you are signed in as a reader.';
  if (readOnly) return 'Main is read only: use Edit to restore in a change request.';
  if (mtimeMs === null) return 'The page is not in this change request any more.';
  if (selected === NOW) return 'Pick an older version to restore it.';
  return null;
}
