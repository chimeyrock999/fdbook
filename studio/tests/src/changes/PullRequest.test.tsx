// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BranchPullRequest, Preview, PreviewClient } from '../../../src/api/preview';
import { PreviewSection } from '../../../src/changes/PreviewSection';
import { ToastStack } from '../../../src/actions/ToastStack';
import { PublishDialog } from '../../../src/changes/PublishDialog';
import { PullRequestSection } from '../../../src/changes/PullRequestSection';
import type { Pusher } from '../../../src/changes/usePush';

afterEach(cleanup);

const PR: BranchPullRequest = { number: 112, url: 'https://github.com/o/r/pull/112', state: 'OPEN', title: 'Driver notes' };
const pushed: Preview = {
  branch: 'cr/driver', blocked: null, pushed: { sha: 'a'.repeat(40) }, unpushed: [], uncommitted: 0, url: null, build: null, pr: null, prError: null,
};
const at = (fields: Partial<Preview>): Preview => ({ ...pushed, ...fields });
const chip = () => screen.getByTestId('pr-state').textContent;
const publishButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Publish…' });

function section(preview: Preview, { unsaved = null, busy = false }: { unsaved?: string | null; busy?: boolean } = {}) {
  const onPublish = vi.fn();
  render(<PullRequestSection preview={preview} unsaved={unsaved} busy={busy} onPublish={onPublish} />);
  return onPublish;
}

describe('PullRequestSection', () => {
  it('offers Publish on a pushed branch with no pull request', async () => {
    const onPublish = section(pushed);
    expect(chip()).toBe('No pull request');
    expect(screen.getByText('Publish opens a pull request to main for review.')).toBeTruthy();
    await userEvent.click(publishButton());
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('says Publish pushes first, and waits for a commit, a save or a push', () => {
    section(at({ unpushed: ['c', 'b'] }));
    expect(screen.getByText('Publish opens a pull request to main for review. It pushes 2 commits first.')).toBeTruthy();
    expect(publishButton().disabled).toBe(false);
    cleanup();
    section(at({ pushed: null }));
    expect(publishButton().disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Commit a change to publish it.');
    cleanup();
    section(pushed, { unsaved: 'a.mdx' });
    expect(publishButton().disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Saving a.mdx…');
    cleanup();
    section(pushed, { busy: true });
    expect(publishButton().disabled).toBe(true);
  });

  it('shows the pull request and its state', () => {
    section(at({ pr: PR }));
    expect(chip()).toBe('In review');
    expect(screen.getByRole('link', { name: 'Driver notes' }).getAttribute('href')).toBe(PR.url);
    expect(screen.getByText('#112 · cr/driver → main')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publish…' })).toBeNull();
    cleanup();
    section(at({ pr: { ...PR, state: 'MERGED' } }));
    expect(chip()).toBe('Merged');
    expect(screen.getByText('This pull request is merged. Clean it up from the notice above.')).toBeTruthy();
    cleanup();
    section(at({ pr: { ...PR, state: 'CLOSED' } }));
    expect(chip()).toBe('Closed');
  });

  it('says when gh cannot read the pull request, and turns Publish off', () => {
    section(at({ prError: 'gh: not logged in' }));
    expect(screen.getByText('Could not read the pull request (gh: not logged in). Preview still works.')).toBeTruthy();
    expect(publishButton().disabled).toBe(true);
  });

  it('shows nothing where there is no preview', () => {
    section(at({ blocked: 'Only change requests (cr/…) get a preview.' }));
    expect(screen.queryByLabelText('Pull request')).toBeNull();
  });
});

describe('PreviewSection with a pull request open', () => {
  it('pushes to it as Update PR', async () => {
    const preview = at({ unpushed: ['c'], pr: PR });
    const pusher: Pusher = { busy: false, result: null, push: vi.fn(() => Promise.resolve(true)) };
    render(<PreviewSection pusher={pusher} preview={preview} error={null} unsaved={null} route="/notes" />);
    expect(screen.getByText('Pushes to the open pull request #112; no new pull request.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Update PR (1 commit)' }));
    expect(pusher.push).toHaveBeenCalledWith(preview);
  });
});

describe('PublishDialog', () => {
  const setup = (preview: Preview, client: Partial<PreviewClient>) => {
    const onPublished = vi.fn();
    const onClose = vi.fn();
    render(<><PublishDialog client={client as PreviewClient} preview={preview} onPublished={onPublished} onClose={onClose} /><ToastStack /></>);
    return { onPublished, onClose };
  };
  const title = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Title' });
  const body = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: /^Description/ });

  it('fills the draft, takes edits and publishes them', async () => {
    const answer = at({ pr: PR });
    const publish = vi.fn(() => Promise.resolve(answer));
    const { onPublished } = setup(at({ unpushed: ['c'] }), { draft: () => Promise.resolve({ title: 'Driver notes', body: '- docs(notes): one' }), publish });
    await waitFor(() => { expect(title().value).toBe('Driver notes'); });
    expect(body().value).toBe('- docs(notes): one');
    expect(screen.getByText(/Pushes 1 commit first\./)).toBeTruthy();
    await userEvent.type(title(), ', edited');
    await userEvent.type(body(), '\nMore.');
    await userEvent.click(screen.getByRole('button', { name: 'Push and publish' }));
    expect(publish).toHaveBeenCalledWith('Driver notes, edited', '- docs(notes): one\nMore.');
    await waitFor(() => { expect(onPublished).toHaveBeenCalledWith(answer); });
  });

  it('cannot be closed while it publishes, so its end is always shown', async () => {
    let refuse: (reason: Error) => void = () => undefined;
    const publish = vi.fn(() => new Promise<Preview>((_resolve, reject) => { refuse = reject; }));
    const { onClose } = setup(pushed, { draft: () => Promise.resolve({ title: 'Driver notes', body: '' }), publish });
    await waitFor(() => { expect(title().value).toBe('Driver notes'); });
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true);
    // Everything in it is off while it publishes: send Escape and a backdrop click to the dialog itself.
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    if (dialog.parentElement) fireEvent.mouseDown(dialog.parentElement);
    expect(onClose).not.toHaveBeenCalled();
    refuse(new Error('Could not open the pull request: timed out'));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not open the pull request: timed out');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses the title once the draft is read, and again after a failure, so Escape closes it', async () => {
    const publish = vi.fn(() => Promise.reject(new Error('Could not open the pull request: forbidden')));
    const { onClose } = setup(pushed, { draft: () => Promise.resolve({ title: 'Driver notes', body: '' }), publish });
    await waitFor(() => { expect(document.activeElement).toBe(title()); });
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await screen.findByRole('alert');
    await waitFor(() => { expect(document.activeElement).toBe(title()); });
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('wants a title', async () => {
    const publish = vi.fn();
    setup(pushed, { draft: () => Promise.resolve({ title: 'Driver notes', body: '' }), publish });
    await waitFor(() => { expect(title().value).toBe('Driver notes'); });
    await userEvent.clear(title());
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Publish' });
    expect(button.disabled).toBe(true);
    expect(publish).not.toHaveBeenCalled();
  });

  it('says what the server refused in a toast, keeps the dialog, and can try again', async () => {
    const publish = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error('Could not open the pull request: forbidden The branch is pushed; try again.')))
      .mockImplementationOnce(() => Promise.resolve(at({ pr: PR })));
    const { onPublished } = setup(pushed, { draft: () => Promise.resolve({ title: 'Driver notes', body: '' }), publish });
    await waitFor(() => { expect(title().value).toBe('Driver notes'); });
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not open the pull request: forbidden The branch is pushed; try again.');
    expect(onPublished).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => { expect(onPublished).toHaveBeenCalledTimes(1); });
  });

  it('says why the draft could not be read', async () => {
    setup(pushed, { draft: () => Promise.reject(new Error('HEAD is detached: preview a change request.')) });
    expect((await screen.findByRole('alert')).textContent).toBe('HEAD is detached: preview a change request.');
  });
});
