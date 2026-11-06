import type { Preview } from '#api/preview.ts';
import { plural } from '#features/assets/asset-changes.ts';

export type PrimaryKind = 'commit' | 'preview' | 'update' | 'publish' | 'view';
export type PrimaryAction = {
  kind: PrimaryKind;
  label: string;
  // What it does, or why it is off.
  title: string;
  disabled: boolean;
  // View PR: the pull request.
  href?: string;
  // Its request is out (a push): it waits, and shows it.
  pending?: boolean;
};

// The header's one main action for a change request (#20): Commit → Preview
// → Publish → View PR, and Update PR for commits made after publishing.
// Files not committed come first: Commit opens the Changes view, where they
// are picked. Null when there is nothing to offer (main, or a branch that
// cannot be previewed and has nothing to commit).
export function primaryActionOf({ uncommitted, preview, unsaved, busy }: {
  uncommitted: number;
  preview: Preview | null;
  unsaved: string | null;
  // A push is running. A publish runs in its dialog, which stays open until it ends.
  busy: boolean;
}): PrimaryAction | null {
  const commit: PrimaryAction = { kind: 'commit', label: 'Commit', title: 'Pick the files and write a message in Changes', disabled: false };
  if (uncommitted > 0) return commit;
  if (preview?.blocked !== null) return null;
  const count = preview.unpushed.length;
  // A push waits for the open note to save, as a commit does.
  const waiting = (action: PrimaryAction): PrimaryAction => {
    if (busy) return { ...action, label: 'Pushing…', disabled: true, pending: true };
    return unsaved === null ? action : { ...action, title: `Saving ${unsaved}…`, disabled: true };
  };
  const { pr } = preview;
  if (pr?.state === 'OPEN' && count > 0) {
    return waiting({ kind: 'update', label: 'Update PR', title: `Push ${plural(count, 'commit')} to pull request #${String(pr.number)}`, disabled: false });
  }
  if (pr !== null) return { kind: 'view', label: 'View PR', title: `Pull request #${String(pr.number)} on GitHub`, disabled: false, href: pr.url };
  if (count > 0) return waiting({ kind: 'preview', label: 'Preview', title: `Push ${plural(count, 'commit')}; Cloudflare builds the preview`, disabled: false });
  if (preview.pushed !== null) {
    if (preview.prError !== null) return { kind: 'publish', label: 'Publish', title: `Could not read the pull request: ${preview.prError}`, disabled: true };
    return waiting({ kind: 'publish', label: 'Publish', title: 'Open a pull request to main', disabled: false });
  }
  return { ...commit, title: 'Nothing to commit yet: edit a note first.', disabled: true };
}
