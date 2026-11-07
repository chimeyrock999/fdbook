import { NOW, type DeletedPage, type PageHistory } from '#api/history.ts';

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
// signed-in person may read but not write (#99). A page gone from the
// worktree comes back whole (src/features/history/RestoreDeleted.tsx); an asset
// gone has no way back here.
export function restoreBlocked({ selected, readOnly, reader = false, mtimeMs, asset = false }: { selected: string; readOnly: boolean; reader?: boolean; mtimeMs: number | null; asset?: boolean }) {
  if (reader) return 'Restoring needs write access to the repository; you are signed in as a reader.';
  if (readOnly) return 'Main is read only: use Edit to restore in a change request.';
  if (mtimeMs === null && asset) return 'The asset is not in this change request any more.';
  if (selected === NOW) return 'Pick an older version to restore it.';
  return null;
}

// `committed: false`: the deletes not committed yet, one group first.
type Group = { sha: string; message: string; author: string; date: string; committed: boolean; pages: DeletedPage[] };

// The pages in commit order, one group per commit that deleted them, after
// one group of the deletes not committed yet.
export function groupDeleted(pages: readonly DeletedPage[]): Group[] {
  const groups: Group[] = [];
  for (const page of pages) {
    const last = groups.at(-1);
    if (!page.committed && last?.committed === false) last.pages.push(page);
    else if (page.committed && last?.committed === true && last.sha === page.sha) last.pages.push(page);
    else groups.push({ sha: page.sha, message: page.message, author: page.author, date: page.date, committed: page.committed, pages: [page] });
  }
  return groups;
}
