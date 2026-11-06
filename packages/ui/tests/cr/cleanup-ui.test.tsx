// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { ToastStack } from '#components/ToastStack.tsx';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangeRequest, CrClient, CrList, Discard } from '#api/crs.ts';
import { DiscardDialog } from '#cr/CrDialogs.tsx';
import { CrListPage } from '#cr/CrListPage.tsx';
import { CrNotice } from '#cr/CrNotice.tsx';
import { mergeCommand } from '#cr/cr-status.ts';

const DAY_MS = 24 * 3600_000;

const cr = (slug: string, status: ChangeRequest['status'], more: Partial<ChangeRequest> = {}): ChangeRequest => ({
  slug,
  name: slug,
  branch: `cr/${slug}`,
  status,
  pushed: status !== 'draft',
  worktree: `/home/me/.chimey-studio/worktrees/${slug}`,
  changedPages: 1,
  uncommitted: 0,
  updatedMs: Date.now() - 60_000,
  previewUrl: null,
  pr: null,
  stale: false,
  drift: status === 'merged' || status === 'closed' ? null : { behind: 0, conflicts: [] },
  ...more,
});

const list = (crs: ChangeRequest[], more: Partial<CrList> = {}): CrList => ({ enabled: true, taken: [], prError: null, fetchError: null, crs, ...more });

const renderList = (value: CrList) => {
  const props = { onOpen: vi.fn(), onNew: vi.fn(), onDiscard: vi.fn(), onRefresh: vi.fn() };
  render(<CrListPage list={value} error={null} current={null} {...props} />);
  return props;
};

afterEach(cleanup);

describe('the change request list (#21)', () => {
  it('says how far each one is from main', () => {
    renderList(list([
      cr('even', 'draft'),
      cr('behind', 'previewing', { drift: { behind: 3, conflicts: [] } }),
      cr('clash', 'review', { drift: { behind: 12, conflicts: ['content/docs/databricks/interactive.mdx', 'content/docs/databricks/meta.yaml'] } }),
    ]));
    expect(screen.getByRole('listitem', { name: 'even' }).textContent).toContain('Up to date with main');
    expect(screen.getByRole('listitem', { name: 'behind' }).textContent).toContain('3 commits behind main');
    const clash = screen.getByRole('listitem', { name: 'clash' });
    expect(clash.textContent).toContain('Conflicts with main in 2 files: databricks/interactive.mdx, databricks/meta.yaml. 12 commits behind main.');
    expect(clash.textContent).not.toContain('Up to date');
  });

  it('marks a stale one and suggests discarding it, without doing so', () => {
    const { onDiscard } = renderList(list([cr('old', 'previewing', { stale: true, updatedMs: Date.now() - 34 * DAY_MS - 60_000 })]));
    const card = screen.getByRole('listitem', { name: 'old' });
    expect(card.textContent).toContain('Stale');
    expect(card.textContent).toContain('Not touched for 34 days. Discard it if it is no longer needed.');
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('offers Clean up for merged and closed ones, and Discard for the others', async () => {
    const merged = cr('done', 'merged', { pr: { number: 57, url: 'u' } });
    const { onDiscard } = renderList(list([cr('open', 'draft'), merged, cr('gone', 'closed')]));
    expect(screen.queryByRole('button', { name: 'Discard done' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Discard open' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clean up gone' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clean up done' }));
    expect(onDiscard).toHaveBeenCalledWith(merged);
  });

  it('says when the refresh could not fetch origin', () => {
    renderList(list([], { fetchError: 'Could not resolve host: github.com' }));
    expect(screen.getByRole('status').textContent).toBe('Could not fetch origin (Could not resolve host: github.com): main and the branches are as last fetched.');
  });
});

describe('cleaning up in the dialog', () => {
  const plan = (more: Partial<Discard> = {}): Discard => ({
    slug: 'done', branch: 'cr/done', status: 'merged', worktree: '/w/done', commits: 2, uncommitted: 0, pushed: true, unpushed: 0, pr: { number: 57, url: 'u' }, closesPr: null, prError: null, ...more,
  });

  it('says the pull request was merged, lists both sides and cleans up', async () => {
    const discard = vi.fn(() => Promise.resolve(plan()));
    const onDone = vi.fn();
    render(<><DiscardDialog client={{ discard } as unknown as CrClient} cr={cr('done', 'merged', { pr: { number: 57, url: 'u' } })} current={false} onDone={onDone} onClose={vi.fn()} /><ToastStack /></>);
    const dialog = screen.getByRole('dialog', { name: 'Clean up “done”?' });
    expect(dialog.textContent).toContain('Pull request #57 was merged. Its changes are on main.');
    const origin = await within(dialog).findByRole('list', { name: 'From origin' });
    expect(origin.textContent).toBe('Branch cr/done');
    const submit = within(dialog).getByRole('button', { name: 'Clean up' });
    expect(submit.className).toContain('studio-button-primary');
    await userEvent.click(submit);
    // With what the dry run said about origin, so the server refuses if it changed.
    expect(discard).toHaveBeenLastCalledWith('done', false, { pushed: true, closesPr: null });
    await waitFor(() => { expect(onDone).toHaveBeenCalled(); });
  });

  it('says when the branch is already gone from origin, and what was never pushed', async () => {
    const discard = vi.fn(() => Promise.resolve(plan({ status: 'closed', pushed: false, unpushed: 0, pr: { number: 44, url: 'u' } })));
    render(<><DiscardDialog client={{ discard } as unknown as CrClient} cr={cr('done', 'closed', { pr: { number: 44, url: 'u' } })} current={false} onDone={vi.fn()} onClose={vi.fn()} /><ToastStack /></>);
    expect(await screen.findByText('The branch is already gone from origin.')).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toContain('Pull request #44 was closed without merging.');
  });

  it('goes by the status the dry run read, not the list\'s', async () => {
    const discard = vi.fn(() => Promise.resolve(plan({ status: 'merged' })));
    render(<><DiscardDialog client={{ discard } as unknown as CrClient} cr={cr('done', 'review', { pr: { number: 57, url: 'u' } })} current={false} onDone={vi.fn()} onClose={vi.fn()} /><ToastStack /></>);
    expect(await screen.findByRole('dialog', { name: 'Clean up “done”?' })).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toContain('Pull request #57 was merged.');
  });

  it('takes the pull request from the dry run when the list had none yet', async () => {
    const discard = vi.fn(() => Promise.resolve(plan({ pr: { number: 58, url: 'u' } })));
    render(<><DiscardDialog client={{ discard } as unknown as CrClient} cr={cr('done', 'previewing')} current={false} onDone={vi.fn()} onClose={vi.fn()} /><ToastStack /></>);
    expect(await screen.findByText('Pull request #58 was merged. Its changes are on main.')).toBeTruthy();
  });

  it('cannot remove a pushed branch while the pull requests cannot be read', async () => {
    const discard = vi.fn(() => Promise.resolve(plan({ status: 'previewing', pr: null, prError: 'gh: not logged in' })));
    render(<><DiscardDialog client={{ discard } as unknown as CrClient} cr={cr('done', 'previewing')} current={false} onDone={vi.fn()} onClose={vi.fn()} /><ToastStack /></>);
    expect((await screen.findByRole('alert')).textContent).toBe('Pull requests could not be read (gh: not logged in). A pull request of this branch would close without notice, so it cannot be discarded until gh works again.');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Discard' }).disabled).toBe(true);
  });

  it('checks again after a refused discard, and shows what a new try would do', async () => {
    let checks = 0;
    const discard = vi.fn((_slug: string, dryRun?: boolean) => {
      if (!dryRun) return Promise.reject(new Error('cr/done changed on origin since this was checked. Nothing was removed: look again before discarding.'));
      checks += 1;
      return Promise.resolve(plan({ status: checks > 1 ? 'previewing' : 'draft', pr: null, pushed: checks > 1 }));
    });
    render(<><DiscardDialog client={{ discard } as unknown as CrClient} cr={cr('done', 'draft')} current={false} onDone={vi.fn()} onClose={vi.fn()} /><ToastStack /></>);
    expect(await screen.findByText('Never pushed: nothing to remove there.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(await screen.findByRole('list', { name: 'From origin' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('changed on origin since this was checked');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Discard' }).disabled).toBe(false);
    expect(discard).toHaveBeenCalledTimes(3);
  });

  it('shows why origin refused, and keeps the dialog open', async () => {
    const discard = vi.fn((_slug: string, dryRun?: boolean) =>
      dryRun ? Promise.resolve(plan()) : Promise.reject(new Error('Could not remove it from origin: denied. Nothing was removed from this machine.')));
    const onDone = vi.fn();
    render(<><DiscardDialog client={{ discard } as unknown as CrClient} cr={cr('done', 'merged')} current={false} onDone={onDone} onClose={vi.fn()} /><ToastStack /></>);
    await userEvent.click(await screen.findByRole('button', { name: 'Clean up' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not remove it from origin: denied. Nothing was removed from this machine.');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('CrNotice', () => {
  it('lists the conflicting files and the command to merge main', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CrNotice cr={cr('clash', 'previewing', { drift: { behind: 12, conflicts: ['content/docs/databricks/interactive.mdx'] } })} onCleanUp={vi.fn()} />);
    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('Conflicts with main in 1 file. Main is 12 commits ahead of this change request.');
    expect(within(notice).getByRole('list', { name: 'Conflicting files' }).textContent).toBe('databricks/interactive.mdx');
    expect(notice.textContent).toContain('cd /home/me/.chimey-studio/worktrees/clash && git merge origin/main');
    await userEvent.click(within(notice).getByRole('button', { name: 'Copy command' }));
    expect(writeText).toHaveBeenCalledWith('cd /home/me/.chimey-studio/worktrees/clash && git merge origin/main');
    expect(await within(notice).findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('selects the command when the browser blocks copying (#116)', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    try {
      render(<CrNotice cr={cr('clash', 'draft', { drift: { behind: 2, conflicts: [] } })} onCleanUp={vi.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: 'Copy command' }));
      expect(await screen.findByRole('button', { name: 'Copying is blocked: the command is selected, copy it with Ctrl+C' })).toBeTruthy();
      expect(window.getSelection()?.toString()).toBe('cd /home/me/.chimey-studio/worktrees/clash && git merge origin/main');
    } finally {
      Reflect.deleteProperty(document, 'execCommand');
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('says a change request behind main merges cleanly', () => {
    render(<CrNotice cr={cr('behind', 'draft', { drift: { behind: 1, conflicts: [] } })} onCleanUp={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('Main is 1 commit ahead of this change request. It merges without conflicts.');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows nothing for one up to date with main', () => {
    const { container } = render(<CrNotice cr={cr('even', 'draft')} onCleanUp={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  it('offers to clean up once the pull request is merged', async () => {
    const onCleanUp = vi.fn();
    render(<CrNotice cr={cr('done', 'merged', { pr: { number: 57, url: 'u' } })} onCleanUp={onCleanUp} />);
    expect(screen.getByRole('status').textContent).toContain('Pull request #57 was merged.');
    await userEvent.click(screen.getByRole('button', { name: 'Clean up' }));
    expect(onCleanUp).toHaveBeenCalled();
  });

  it('quotes a worktree path the shell would split', () => {
    expect(mergeCommand("/Users/me/My Notes/it's")).toBe(`cd '/Users/me/My Notes/it'\\''s' && git merge origin/main`);
  });
});
