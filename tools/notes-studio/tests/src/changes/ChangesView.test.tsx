// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangedFile, Changes, ChangesClient, Commit, History } from '../../../src/api/changes';
import type { createFilesClient, FileEvent } from '../../../src/api/files';
import { ChangesView } from '../../../src/changes/ChangesView';
import { LeaveNotice } from '../../../src/changes/LeaveNotice';
import { leaveNotice, leftBehind, rememberLeave } from '../../../src/changes/leave';
import { useChanges } from '../../../src/changes/useChanges';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const files: ChangedFile[] = [
  { path: 'content/notes/streaming/exactly-once-sinks.mdx', status: 'A' },
  { path: 'content/notes/streaming/meta.yaml', status: 'M' },
  { path: 'content/notes/streaming/watermarks.mdx', status: 'M' },
  { path: 'content/notes/distributed-systems/rpc-and-threads.mdx', status: 'D' },
  { path: 'public/notes/streaming/timeline.png', status: 'A' },
];
const titles = new Map([
  ['content/notes/streaming/watermarks.mdx', 'Watermark and late events'],
  ['content/notes/streaming/exactly-once-sinks.mdx', 'Exactly-once sinks'],
  ['content/notes/streaming/meta.yaml', 'Streaming'],
]);
const history: History = {
  base: 'origin/main',
  commits: [{ sha: '8e41c2a0000000000000000000000000000000aa', date: new Date(Date.now() - 42 * 60_000).toISOString(), message: 'docs(notes): add watermarks', files: [{ status: 'A', path: 'content/notes/streaming/watermarks.mdx' }] }],
};
const made: Commit = { sha: '1234567890abcdef1234567890abcdef12345678', date: new Date().toISOString(), message: 'm', files: [{ status: 'M', path: 'x' }] };

function setup({ changes = { branch: 'cr/sinks', files }, unsaved = null, commit = vi.fn(() => Promise.resolve(made)) }: {
  changes?: Changes;
  unsaved?: string | null;
  commit?: ChangesClient['commit'];
} = {}) {
  const props = { onOpen: vi.fn(), onCommitted: vi.fn(() => Promise.resolve()) };
  const client = { commit } as unknown as ChangesClient;
  const view = render(<ChangesView client={client} changes={changes} history={history} error={null} titles={titles} unsaved={unsaved} {...props} />);
  return { ...props, commit, view };
}
const message = () => screen.getByLabelText<HTMLTextAreaElement>('Commit message');
const submit = () => screen.getByRole<HTMLButtonElement>('button', { name: /^Commit \d+ files?$/ });

describe('ChangesView', () => {
  it('lists pages and assets with their status, all picked, and suggests a message', () => {
    setup();
    const pages = within(screen.getByRole('region', { name: 'Pages' }));
    expect(pages.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Exactly-once sinksstreaming/exactly-once-sinks.mdxA',
      'Page order of Streamingstreaming/meta.yamlM',
      'Watermark and late eventsstreaming/watermarks.mdxM',
      'rpc-and-threadsdistributed-systems/rpc-and-threads.mdxD',
    ]);
    expect(within(screen.getByRole('region', { name: 'Assets' })).getByText('timeline.png')).toBeTruthy();
    expect(screen.getAllByRole<HTMLInputElement>('checkbox').every((box) => box.checked)).toBe(true);
    expect(message().value).toBe('docs(notes): update 3 pages');
    expect(submit().textContent).toBe('Commit 5 files');
    expect(screen.getByText('cr/sinks')).toBeTruthy();
  });

  it('follows the picked files until the message is edited, and can go back to the suggestion', async () => {
    setup();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pick all pages' }));
    expect(message().value).toBe('docs(notes): update assets of streaming');
    expect(submit().textContent).toBe('Commit 1 file');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Commit streaming/watermarks.mdx' }));
    expect(message().value).toBe('docs(notes): update watermarks');
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Pick all pages' }).indeterminate).toBe(true);
    await userEvent.clear(message());
    await userEvent.type(message(), 'docs(notes): my words');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Commit streaming/meta.yaml' }));
    expect(message().value).toBe('docs(notes): my words');
    await userEvent.click(screen.getByRole('button', { name: 'Use the suggestion' }));
    expect(message().value).toBe('docs(notes): update watermarks');
  });

  it('will not commit without a message or a file, and says why', async () => {
    setup();
    await userEvent.clear(message());
    expect(submit().disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Write a commit message.');
    expect(message().getAttribute('aria-invalid')).toBe('true');
    await userEvent.type(message(), '   ');
    expect(submit().disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Use the suggestion' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pick all pages' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pick all assets' }));
    expect(submit().disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Pick at least one file.');
  });

  it('waits for the open note to save, and never commits on main', () => {
    const { view } = setup({ unsaved: 'streaming/watermarks.mdx' });
    expect(submit().disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Saving streaming/watermarks.mdx…');
    view.unmount();
    setup({ changes: { branch: 'main', files } });
    expect(submit().disabled).toBe(true);
    expect(screen.getByText(/You are on/).textContent).toContain('Open a change request to commit');
    expect(screen.getByRole('status').textContent).toBe('Commit in a change request, not on main.');
  });

  it('commits the picked files with the message, then reloads and opens the new commit', async () => {
    const { commit, onCommitted } = setup();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Commit streaming/timeline.png' }));
    await userEvent.click(submit());
    expect(commit).toHaveBeenCalledWith('docs(notes): update 3 pages', [
      'content/notes/streaming/exactly-once-sinks.mdx',
      'content/notes/streaming/meta.yaml',
      'content/notes/streaming/watermarks.mdx',
      'content/notes/distributed-systems/rpc-and-threads.mdx',
    ]);
    expect((await screen.findByRole('status')).textContent).toBe('Committed 1 file (1234567).');
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it('keeps an unchecked file unchecked across a commit, and picks it again once it left and came back', async () => {
    const client = { commit: vi.fn(() => Promise.resolve(made)) } as unknown as ChangesClient;
    const view = (changes: Changes) => (
      <ChangesView client={client} changes={changes} history={history} error={null} titles={titles} unsaved={null} onOpen={vi.fn()} onCommitted={() => Promise.resolve()} />
    );
    const { rerender } = render(view({ branch: 'cr/sinks', files }));
    const box = () => screen.getByRole<HTMLInputElement>('checkbox', { name: 'Commit streaming/watermarks.mdx' });
    await userEvent.click(box());
    await userEvent.click(submit());
    await screen.findByText(/^Committed/);
    // The reload after the commit: the others are gone, the unchecked one stays.
    rerender(view({ branch: 'cr/sinks', files: [files[2]] }));
    expect(box().checked).toBe(false);
    // Committed in a terminal, then edited again: it comes back picked.
    rerender(view({ branch: 'cr/sinks', files: [] }));
    rerender(view({ branch: 'cr/sinks', files: [files[2]] }));
    expect(box().checked).toBe(true);
  });

  it('shows what git said when a commit fails', async () => {
    setup({ commit: vi.fn(() => Promise.reject(new Error('git commit failed: Author identity unknown'))) });
    await userEvent.click(submit());
    expect((await screen.findByRole('alert')).textContent).toBe('git commit failed: Author identity unknown');
    expect(message().value).toBe('docs(notes): update 3 pages');
  });

  it('opens notes and assets, not deleted files or meta.yaml', async () => {
    const { onOpen } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Watermark and late events' }));
    expect(onOpen).toHaveBeenCalledWith(files[2]);
    await userEvent.click(screen.getByRole('button', { name: 'timeline.png' }));
    expect(onOpen).toHaveBeenCalledWith(files[4]);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'rpc-and-threads' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Page order of Streaming' }).disabled).toBe(true);
  });

  it('on main (read only) lists the changes without a commit box', () => {
    render(<ChangesView client={{} as ChangesClient} changes={{ branch: null, files }} history={history} error={null} titles={titles} unsaved={null} readOnly onOpen={vi.fn()} onCommitted={() => Promise.resolve()} />);
    expect(screen.getByText(/Main is read only/)).toBeTruthy();
    expect(screen.queryByLabelText('Commit message')).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(screen.queryByRole('button', { name: /^Commit/ })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Pages' })).getAllByRole('listitem')).toHaveLength(4);
  });

  it('lists the change request commits with their files', async () => {
    setup({ changes: { branch: 'cr/sinks', files: [] } });
    expect(screen.getByText(/No changes to commit/).textContent).toBe('No changes to commit on cr/sinks.');
    expect(screen.getByText('1 commit since origin/main')).toBeTruthy();
    const item = screen.getByRole('button', { name: /docs\(notes\): add watermarks/ });
    expect(item.textContent).toContain('42 min ago');
    expect(item.textContent).toContain('8e41c2a');
    await userEvent.click(item);
    expect(screen.getByText('streaming/watermarks.mdx')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /History/ }));
    expect(screen.queryByRole('button', { name: /docs\(notes\): add watermarks/ })).toBeNull();
  });
});

describe('useChanges', () => {
  function Probe({ client, events }: { client: ChangesClient; events: ReturnType<typeof createFilesClient> }) {
    const { changes, error } = useChanges(client, events);
    return <p>{error ?? (changes ? String(changes.files.length) : 'loading')}</p>;
  }

  it('reloads after a burst of note or asset events, and when the window comes back', async () => {
    let listener: (event: FileEvent) => void = () => undefined;
    const events = { subscribeFileEvents: (next: (event: FileEvent) => void) => { listener = next; return () => undefined; } } as unknown as ReturnType<typeof createFilesClient>;
    const counts = [0, 1, 2];
    const loadChanges = vi.fn(() => Promise.resolve({ branch: 'cr/x', files: Array<ChangedFile>(counts.shift() ?? 3).fill(files[0]) }));
    const loadHistory = vi.fn(() => Promise.resolve(history));
    render(<Probe client={{ loadChanges, loadHistory } as unknown as ChangesClient} events={events} />);
    expect(await screen.findByText('0')).toBeTruthy();
    listener({ type: 'change', path: 'content/notes/a.mdx', mtimeMs: 1 });
    listener({ type: 'add', path: 'public/notes/b.png', mtimeMs: 2 });
    listener({ type: 'change', path: 'package.json', mtimeMs: 3 });
    expect(await screen.findByText('1')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(loadChanges).toHaveBeenCalledTimes(2);
    // A file event cannot add a commit: only the changes load again.
    expect(loadHistory).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(await screen.findByText('2')).toBeTruthy();
    expect(loadHistory).toHaveBeenCalledTimes(2);
  });

  it('reports changes that cannot load', async () => {
    const events = { subscribeFileEvents: () => () => undefined } as unknown as ReturnType<typeof createFilesClient>;
    const client = { loadChanges: () => Promise.reject(new Error('not a git worktree')), loadHistory: () => Promise.resolve(history) } as unknown as ChangesClient;
    render(<Probe client={client} events={events} />);
    await waitFor(() => { expect(screen.getByText('not a git worktree')).toBeTruthy(); });
  });
});

describe('LeaveNotice', () => {
  it('reminds only about a change request with uncommitted files', () => {
    expect(leaveNotice(null, 'x')).toBeNull();
    expect(leaveNotice({ branch: 'cr/x', files: [] }, 'x')).toBeNull();
    // Main is read only: leaving it leaves nothing behind.
    expect(leaveNotice({ branch: null, files }, null)).toBeNull();
    expect(leaveNotice({ branch: 'cr/x', files }, 'x')).toEqual({ cr: 'x', branch: 'cr/x', count: 5 });
  });

  it('carries the reminder to the page the switch loads, not back to the one left', () => {
    sessionStorage.clear();
    rememberLeave({ cr: 'x', branch: 'cr/x', count: 2 });
    expect(leftBehind('y')).toEqual({ cr: 'x', branch: 'cr/x', count: 2 });
    expect(leftBehind(null)).toEqual({ cr: 'x', branch: 'cr/x', count: 2 });
    expect(leftBehind('x')).toBeNull();
    rememberLeave(null);
    expect(leftBehind('y')).toBeNull();
    sessionStorage.setItem('notes-studio:left-cr', '{"cr":1}');
    expect(leftBehind('y')).toBeNull();
  });

  it('blocks nothing, goes back or away, and leaves by itself', () => {
    vi.useFakeTimers();
    const notice = { cr: 'x', branch: 'cr/x', count: 2 };
    const onBack = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(<LeaveNotice notice={notice} onBack={onBack} onClose={() => { onClose(); }} />);
    expect(screen.getByRole('status').textContent).toContain('2 files in cr/x are not committed.');
    fireEvent.click(screen.getByRole('button', { name: 'Back to cr/x' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(5000); });
    // The parent renders again with a new inline onClose: the timer goes on.
    rerender(<LeaveNotice notice={notice} onBack={onBack} onClose={() => { onClose(); }} />);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
