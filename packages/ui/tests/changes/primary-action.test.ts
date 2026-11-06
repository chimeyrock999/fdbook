import { describe, expect, it } from 'vitest';
import type { BranchPullRequest, Preview } from '#api/preview.ts';
import { primaryActionOf } from '#changes/primary-action.ts';

const PR: BranchPullRequest = { number: 112, url: 'https://github.com/o/r/pull/112', state: 'OPEN', title: 'Driver notes' };
const draft: Preview = { branch: 'cr/driver', blocked: null, pushed: null, unpushed: [], uncommitted: 0, url: null, build: null, pr: null, prError: null };
const at = (fields: Partial<Preview>): Preview => ({ ...draft, ...fields });
const pushed = { sha: 'a'.repeat(40) };
const of = (preview: Preview | null, { uncommitted = 0, unsaved = null, busy = false }: { uncommitted?: number; unsaved?: string | null; busy?: boolean } = {}) =>
  primaryActionOf({ uncommitted, preview, unsaved, busy });
const kind = (...args: Parameters<typeof of>) => {
  const action = of(...args);
  return action === null ? null : `${action.label}${action.disabled ? ' (off)' : ''}`;
};

describe('primaryActionOf', () => {
  it('goes Commit → Preview → Publish → View PR', () => {
    expect(kind(draft, { uncommitted: 2 })).toBe('Commit');
    expect(kind(at({ unpushed: ['b'] }))).toBe('Preview');
    expect(kind(at({ pushed }))).toBe('Publish');
    const view = of(at({ pushed, pr: PR }));
    expect(view).toMatchObject({ kind: 'view', label: 'View PR', href: PR.url, disabled: false });
  });

  it('puts files not committed first, whatever else is pending', () => {
    expect(kind(at({ unpushed: ['b'], pr: PR }), { uncommitted: 1 })).toBe('Commit');
    expect(kind(at({ pushed, pr: { ...PR, state: 'MERGED' } }), { uncommitted: 1 })).toBe('Commit');
  });

  it('pushes commits made after publishing to the open pull request', () => {
    expect(of(at({ pushed, unpushed: ['c', 'b'], pr: PR }))).toMatchObject({ kind: 'update', label: 'Update PR', title: 'Push 2 commits to pull request #112' });
  });

  it('offers View PR, not Publish, once the pull request is merged or closed', () => {
    expect(kind(at({ pushed, unpushed: ['c'], pr: { ...PR, state: 'MERGED' } }))).toBe('View PR');
    expect(kind(at({ pushed, pr: { ...PR, state: 'CLOSED' } }))).toBe('View PR');
  });

  it('turns Commit off with nothing to commit, and Publish off when gh cannot say', () => {
    expect(of(draft)).toMatchObject({ kind: 'commit', disabled: true, title: 'Nothing to commit yet: edit a note first.' });
    expect(of(at({ pushed, prError: 'gh: not logged in' }))).toMatchObject({ kind: 'publish', disabled: true, title: 'Could not read the pull request: gh: not logged in' });
  });

  it('waits for the open note to save, and for a push that runs', () => {
    expect(of(at({ unpushed: ['b'] }), { unsaved: 'a.mdx' })).toMatchObject({ kind: 'preview', disabled: true, title: 'Saving a.mdx…' });
    expect(kind(at({ unpushed: ['b'] }), { busy: true })).toBe('Pushing… (off)');
    expect(kind(at({ pushed }), { busy: true })).toBe('Pushing… (off)');
    // Commit only opens Changes; View PR only opens GitHub.
    expect(kind(draft, { uncommitted: 1, unsaved: 'a.mdx' })).toBe('Commit');
    expect(kind(at({ pushed, pr: PR }), { busy: true })).toBe('View PR');
  });

  it('offers nothing on a branch that cannot be previewed, unless there is something to commit', () => {
    const blocked = at({ branch: 'feature/x', blocked: 'Only change requests (cr/…) get a preview.' });
    expect(of(blocked)).toBeNull();
    expect(of(null)).toBeNull();
    expect(kind(blocked, { uncommitted: 3 })).toBe('Commit');
  });
});
