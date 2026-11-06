// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { ToastStack } from '#components/ToastStack.tsx';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangeRequest, CrClient, CrList, Discard } from '#api/crs.ts';
import { crFromSearch, workspaceBase } from '#api/workspace.ts';
import { DiscardDialog, NewCrDialog } from '#cr/CrDialogs.tsx';
import { CrListPage } from '#cr/CrListPage.tsx';
import { CrPicker, EditMenu } from '#cr/CrMenus.tsx';
import { updatedAgo } from '#cr/cr-status.ts';
import { pageFromUrl, pageQuery } from '#app/route.ts';

const cr = (slug: string, status: ChangeRequest['status'], more: Partial<ChangeRequest> = {}): ChangeRequest => ({
  slug,
  name: slug.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' '),
  branch: `cr/${slug}`,
  status,
  pushed: status !== 'draft',
  worktree: `/home/me/.chimey-studio/worktrees/${slug}`,
  changedPages: 0,
  uncommitted: 0,
  updatedMs: Date.now() - 12 * 60_000,
  previewUrl: null,
  pr: null,
  stale: false,
  drift: status === 'merged' || status === 'closed' ? null : { behind: 0, conflicts: [] },
  ...more,
});

const LIST: CrList = {
  enabled: true,
  taken: [],
  prError: null,
  fetchError: null,
  crs: [
    cr('driver-notes', 'draft', { changedPages: 2, uncommitted: 1 }),
    cr('spark-tuning', 'previewing', { changedPages: 5, previewUrl: 'https://cr-spark-tuning.chimey.pages.dev' }),
    cr('uc-grants', 'review', { changedPages: 3, pr: { number: 81, url: 'https://github.com/o/r/pull/81' } }),
    cr('delta-links', 'merged', { pr: { number: 74, url: 'https://github.com/o/r/pull/74' } }),
    cr('old-airflow', 'closed'),
  ],
};

const menuItems = () => within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent.trim());

afterEach(cleanup);

describe('which worktree a page edits', () => {
  it('reads the change request from ?cr= and serves it under /cr/<slug>', () => {
    expect(crFromSearch('?cr=driver-notes&path=x')).toBe('driver-notes');
    for (const search of ['', '?cr=', '?cr=_main', '?cr=../x', '?cr=Driver']) expect(crFromSearch(search)).toBeNull();
    expect(workspaceBase(null)).toBe('');
    expect(workspaceBase('driver-notes')).toBe('/cr/driver-notes');
  });

  it('keeps the change request in the page query, and opens the list from ?view=crs', () => {
    const note = { kind: 'note', path: 'content/docs/a b.mdx' } as const;
    expect(pageQuery(note, 'driver-notes')).toBe('?cr=driver-notes&path=content%2Fnotes%2Fa%20b.mdx');
    expect(crFromSearch(pageQuery(note, 'driver-notes'))).toBe('driver-notes');
    expect(pageFromUrl(pageQuery(note, 'driver-notes'))).toEqual(note);
    expect(pageQuery({ kind: 'crs' }, null)).toBe('?view=crs');
    expect(pageFromUrl('?cr=x&view=crs')).toEqual({ kind: 'crs' });
    expect(pageQuery(null, 'driver-notes')).toBe('?cr=driver-notes');
  });
});

describe('CrPicker', () => {
  const setup = (current: string | null, waiting = false) => {
    const props = { onSwitch: vi.fn(), onNew: vi.fn(), onList: vi.fn() };
    render(<CrPicker list={LIST} current={current} waiting={waiting} {...props} />);
    return props;
  };

  it('shows main as read only, and lists the open change requests to switch to', async () => {
    const { onSwitch, onNew, onList } = setup(null);
    const picker = screen.getByRole('button', { name: 'Change request: main, read only' });
    expect(picker.textContent).toContain('Read only');
    await userEvent.click(picker);
    expect(menuItems()).toEqual(['mainRead only', 'Driver NotesDraft', 'Spark TuningPreviewing', 'Uc GrantsIn review', 'New change request…', 'All change requests']);
    await userEvent.click(screen.getByRole('menuitem', { name: /Spark Tuning/ }));
    expect(onSwitch).toHaveBeenCalledWith('spark-tuning');
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(picker);
    await userEvent.click(screen.getByRole('menuitem', { name: /New change request/ }));
    expect(onNew).toHaveBeenCalled();
    await userEvent.click(picker);
    await userEvent.click(screen.getByRole('menuitem', { name: /All change requests/ }));
    expect(onList).toHaveBeenCalled();
  });

  it('shows the open change request with its status, and switches back to main', async () => {
    const { onSwitch } = setup('uc-grants');
    const picker = screen.getByRole('button', { name: 'Change request: Uc Grants' });
    expect(picker.textContent).toContain('In review');
    await userEvent.click(picker);
    // The current one is checked; picking it again does nothing.
    await userEvent.click(screen.getByRole('menuitem', { name: /Uc Grants/ }));
    expect(onSwitch).not.toHaveBeenCalled();
    await userEvent.click(picker);
    await userEvent.click(screen.getByRole('menuitem', { name: /^main/ }));
    expect(onSwitch).toHaveBeenCalledWith(null);
  });

  it('does not switch or start a new one while the open note has unsaved edits', async () => {
    setup('driver-notes', true);
    await userEvent.click(screen.getByRole('button', { name: 'Change request: Driver Notes' }));
    const disabled = (name: RegExp) => screen.getByRole<HTMLButtonElement>('menuitem', { name }).disabled;
    expect(disabled(/^main/)).toBe(true);
    expect(disabled(/Spark Tuning/)).toBe(true);
    expect(disabled(/New change request/)).toBe(true);
    expect(disabled(/All change requests/)).toBe(false);
    expect(screen.getByRole('menu').textContent).toContain('The open note has unsaved changes. Switch once it shows Saved.');
  });

  it('closes on Escape and on a press outside, and toggles from its button', async () => {
    setup(null);
    const picker = screen.getByRole('button', { name: /main, read only/ });
    await userEvent.click(picker);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(picker);
    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(picker);
    await userEvent.click(picker);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('EditMenu', () => {
  it('offers the open change requests and a new one', async () => {
    const props = { onSwitch: vi.fn(), onNew: vi.fn() };
    render(<EditMenu list={LIST} {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(menuItems()).toEqual(['Driver NotesDraft', 'Spark TuningPreviewing', 'Uc GrantsIn review', 'New change request…']);
    await userEvent.click(screen.getByRole('menuitem', { name: /Driver Notes/ }));
    expect(props.onSwitch).toHaveBeenCalledWith('driver-notes');
  });

  it('starts a new one at once when none is open', async () => {
    const props = { onSwitch: vi.fn(), onNew: vi.fn() };
    render(<EditMenu list={{ ...LIST, crs: LIST.crs.filter((each) => each.status === 'merged') }} {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(props.onNew).toHaveBeenCalled();
  });
});

describe('CrListPage', () => {
  const setup = (list: CrList | null = LIST, current: string | null = null) => {
    const props = { onOpen: vi.fn(), onNew: vi.fn(), onDiscard: vi.fn(), onRefresh: vi.fn() };
    render(<CrListPage list={list} error={null} current={current} {...props} />);
    return props;
  };
  const group = (title: string) => {
    const heading = screen.getByRole('heading', { name: title });
    return heading.parentElement ?? heading;
  };

  it('groups them as in progress, waiting to merge and to clean up', () => {
    setup();
    const names = (title: string) => within(group(title)).queryAllByRole('listitem').map((item) => item.getAttribute('aria-label'));
    expect(names('In progress 2')).toEqual(['Driver Notes', 'Spark Tuning']);
    expect(names('Waiting to merge 1')).toEqual(['Uc Grants']);
    expect(names('To clean up 2')).toEqual(['Delta Links', 'Old Airflow']);
  });

  it('shows each one with its status, branch, counts, last update and links', () => {
    setup();
    const draft = screen.getByRole('listitem', { name: 'Driver Notes' });
    expect(draft.textContent).toContain('Draft');
    expect(draft.textContent).toContain('cr/driver-notes');
    expect(draft.textContent).toContain('2 pages changed · 1 not committed');
    expect(draft.textContent).toContain('Updated 12 minutes ago');
    expect(within(draft).queryByRole('link')).toBeNull();
    const previewing = screen.getByRole('listitem', { name: 'Spark Tuning' });
    expect(within(previewing).getByRole('link', { name: 'Preview' }).getAttribute('href')).toBe('https://cr-spark-tuning.chimey.pages.dev');
    const review = screen.getByRole('listitem', { name: 'Uc Grants' });
    expect(within(review).getByRole('link', { name: 'PR #81' }).getAttribute('href')).toBe('https://github.com/o/r/pull/81');
  });

  it('opens, discards and refreshes', async () => {
    const { onOpen, onDiscard, onRefresh, onNew } = setup(LIST, 'driver-notes');
    const current = screen.getByRole('listitem', { name: 'Driver Notes' });
    // The open one says so, with no button to open it again.
    expect(within(current).queryByRole('button', { name: /^Open/ })).toBeNull();
    expect(within(current).getByText('Current')).toBeTruthy();
    expect(within(current).getByRole('button', { name: 'Discard Driver Notes' })).toBeTruthy();
    await userEvent.click(within(screen.getByRole('listitem', { name: 'Uc Grants' })).getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith('uc-grants');
    await userEvent.click(screen.getByRole('button', { name: 'Clean up Old Airflow' }));
    expect(onDiscard).toHaveBeenCalledWith(LIST.crs[4]);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'New change request' }));
    expect(onNew).toHaveBeenCalled();
  });

  it('waits for the open note to be saved before opening another one', () => {
    const props = { onOpen: vi.fn(), onNew: vi.fn(), onDiscard: vi.fn(), onRefresh: vi.fn() };
    render(<CrListPage list={LIST} error={null} current="driver-notes" waiting {...props} />);
    const open = within(screen.getByRole('listitem', { name: 'Uc Grants' })).getByRole<HTMLButtonElement>('button', { name: 'Open' });
    expect(open.disabled).toBe(true);
    expect(open.title).toBe('The open note has unsaved changes. Switch once it shows Saved.');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'New change request' }).disabled).toBe(true);
  });

  it('says when the pull requests could not be read', () => {
    setup({ ...LIST, prError: 'gh: not logged in' });
    expect(screen.getByRole('status').textContent).toBe('Pull requests could not be read (gh: not logged in): statuses come from git alone.');
  });
});

describe('NewCrDialog', () => {
  it('shows the branch the name gets, and creates it', async () => {
    const created = cr('fix-links-2', 'draft');
    const create = vi.fn(() => Promise.resolve(created));
    const onCreated = vi.fn();
    render(<><NewCrDialog client={{ create } as unknown as CrClient} taken={['fix-links']} onCreated={onCreated} onClose={vi.fn()} /><ToastStack /></>);
    const dialog = screen.getByRole('dialog', { name: 'New change request' });
    const submit = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Create' });
    expect(submit.disabled).toBe(true);
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Name/ }), 'Fix links');
    expect(dialog.textContent).toContain('Branch cr/fix-links-2');
    await userEvent.click(submit);
    expect(create).toHaveBeenCalledWith('Fix links');
    await waitFor(() => { expect(onCreated).toHaveBeenCalledWith(created); });
  });

  it('needs a letter or a digit, and shows why the server refused', async () => {
    const create = vi.fn(() => Promise.reject(new Error('Could not fetch origin/main: offline')));
    render(<><NewCrDialog client={{ create } as unknown as CrClient} taken={[]} onCreated={vi.fn()} onClose={vi.fn()} /><ToastStack /></>);
    const input = screen.getByRole('textbox', { name: /Name/ });
    await userEvent.type(input, '!!');
    expect(screen.getByRole('dialog').textContent).toContain('The name needs a letter or a digit.');
    await userEvent.clear(input);
    await userEvent.type(input, 'Offline{Enter}');
    expect((await screen.findByRole('alert')).textContent).toContain('Could not fetch origin/main: offline');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create' }).disabled).toBe(false);
  });
});

describe('DiscardDialog', () => {
  const plan = (more: Partial<Discard> = {}): Discard => ({
    slug: 'spark-tuning', branch: 'cr/spark-tuning', worktree: '/home/me/.chimey-studio/worktrees/spark-tuning', status: 'previewing', commits: 3, uncommitted: 2, pushed: false, unpushed: 0, pr: null, closesPr: null, prError: null, ...more,
  });

  it('lists what goes from this machine, then discards', async () => {
    const discard = vi.fn((_slug: string, dryRun?: boolean) => Promise.resolve(plan({ ...(dryRun ? {} : { commits: 3 }) })));
    const onDone = vi.fn();
    render(<><DiscardDialog client={{ discard } as unknown as CrClient} cr={LIST.crs[1]} current={false} onDone={onDone} onClose={vi.fn()} /><ToastStack /></>);
    const removed = await screen.findByRole('list', { name: 'From this machine' });
    expect([...removed.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'Worktree /home/me/.chimey-studio/worktrees/spark-tuning',
      'Local branch cr/spark-tuning (3 commits)',
      '2 files with changes not committed',
    ]);
    expect(discard).toHaveBeenCalledWith('spark-tuning', true);
    expect(screen.queryByRole('list', { name: 'From origin' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(discard).toHaveBeenLastCalledWith('spark-tuning', false, { pushed: false, closesPr: null });
    await waitFor(() => { expect(onDone).toHaveBeenCalled(); });
  });

  it('says when it is the change request being worked in', async () => {
    const discard = vi.fn(() => Promise.resolve(plan()));
    const { rerender } = render(<><DiscardDialog client={{ discard } as unknown as CrClient} cr={LIST.crs[1]} current onDone={vi.fn()} onClose={vi.fn()} /><ToastStack /></>);
    expect(await screen.findByText('You are working in this change request. Studio goes back to main afterwards.')).toBeTruthy();
    rerender(<><DiscardDialog client={{ discard } as unknown as CrClient} cr={LIST.crs[1]} current={false} onDone={vi.fn()} onClose={vi.fn()} /><ToastStack /></>);
    expect(screen.queryByText(/You are working in this change request/)).toBeNull();
  });

  it('closes the open pull request and deletes the branch on origin', async () => {
    const discard = vi.fn(() => Promise.resolve(plan({ pushed: true, unpushed: 1, pr: { number: 81, url: 'u' }, closesPr: { number: 81, url: 'u' } })));
    render(<><DiscardDialog client={{ discard } as unknown as CrClient} cr={{ ...LIST.crs[2], previewUrl: 'https://cr-uc-grants.chimey.pages.dev' }} current={false} onDone={vi.fn()} onClose={vi.fn()} /><ToastStack /></>);
    const origin = await screen.findByRole('list', { name: 'From origin' });
    expect([...origin.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'Pull request #81 is closed, not merged',
      'Branch cr/spark-tuning',
      'Its preview stops updating; Cloudflare keeps the last build',
    ]);
    expect(screen.getByText('1 commit never pushed: lost with the local branch.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard' }).className).toContain('studio-button-danger');
  });
});

describe('updatedAgo', () => {
  it('reads as a relative time', () => {
    const now = Date.UTC(2026, 9, 22, 12);
    expect(updatedAgo(now - 10_000, now)).toBe('just now');
    expect(updatedAgo(now - 12 * 60_000, now)).toBe('12 minutes ago');
    expect(updatedAgo(now - 26 * 3600_000, now)).toBe('yesterday');
  });
});
