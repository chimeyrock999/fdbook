// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeClient, Harness, summary } from '#tests/support/agents-ui.tsx';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('notes-studio:agent-panel', 'true');
});
afterEach(cleanup);

const CHATS = [
  summary({ id: 'c1', prompt: 'Review the links', agent: 'codex', agentName: 'Codex', role: 'reviewer', status: 'done', turns: 3, cost: { amount: 0.88, currency: 'USD' }, live: false, lastMs: 3 }),
  summary({ id: 'c2', prompt: 'Tighten the intro', status: 'running', lastMs: 2 }),
  summary({ id: 'c3', prompt: 'Add keywords', status: 'failed', lastMs: 1, live: false }),
];

describe('chat history', () => {
  it('lists the chats with who, how many turns, cost and when, filters them, and opens one', async () => {
    const { client } = fakeClient(CHATS);
    const user = userEvent.setup();
    render(<Harness client={client} />);
    await user.click(await screen.findByRole('button', { name: 'History' }));
    const history = within(screen.getByRole('region', { name: 'Chats in this change request' }));
    const first = await history.findByRole('button', { name: /^Review the links/ });
    expect(within(first).getByText('Codex · Reviewer', { exact: false })).toBeTruthy();
    expect(within(first).getByText('3 turns')).toBeTruthy();
    expect(within(first).getByText('$0.88')).toBeTruthy();
    await user.type(history.getByRole('searchbox', { name: 'Filter chats' }), 'intro');
    expect(history.queryByRole('button', { name: /^Review the links/ })).toBeNull();
    await user.click(history.getByRole('button', { name: /^Tighten the intro/ }));
    expect(client.read).toHaveBeenCalledWith('c2');
    expect(screen.getByRole('region', { name: 'Chat with Claude Code' })).toBeTruthy();
  });

  it('deletes a chat after a confirmation beside its button, which Keep and Escape close', async () => {
    const { client } = fakeClient(CHATS);
    const user = userEvent.setup();
    render(<Harness client={client} />);
    await user.click(await screen.findByRole('button', { name: 'History' }));
    const trash = await screen.findByRole('button', { name: 'Delete: Review the links' });
    await user.click(trash);
    await user.click(within(screen.getByRole('dialog', { name: 'Delete this chat?' })).getByRole('button', { name: 'Keep' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trash);
    await user.click(trash);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(client.remove).not.toHaveBeenCalled();
    await user.click(trash);
    await user.click(within(screen.getByRole('dialog', { name: 'Delete this chat?' })).getByRole('button', { name: 'Delete' }));
    expect(client.remove).toHaveBeenCalledWith('c1');
    await waitFor(() => { expect(screen.queryByRole('button', { name: /^Review the links/ })).toBeNull(); });
    // A chat whose agent is answering is not deleted.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Delete: Tighten the intro' }).disabled).toBe(true);
  });

  it('deletes several chats picked with Select, never one whose agent is answering', async () => {
    const { client } = fakeClient(CHATS);
    const user = userEvent.setup();
    render(<Harness client={client} />);
    await user.click(await screen.findByRole('button', { name: 'History' }));
    await user.click(await screen.findByRole('button', { name: 'Select' }));
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Pick: Tighten the intro' }).disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'Pick: Review the links' }));
    await user.click(screen.getByRole('checkbox', { name: 'Pick: Add keywords' }));
    await user.click(screen.getByRole('button', { name: 'Delete 2 chats' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete 2 chats?' })).getByRole('button', { name: 'Delete' }));
    expect(client.remove.mock.calls).toEqual([['c1'], ['c3']]);
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'Delete 2 chats' })).toBeNull(); });
    expect(screen.getByRole('button', { name: /^Tighten the intro/ })).toBeTruthy();
  });

  it('drops a chat another page deleted', async () => {
    const { client, emit } = fakeClient(CHATS);
    const user = userEvent.setup();
    render(<Harness client={client} />);
    await user.click(await screen.findByRole('button', { name: 'History' }));
    await screen.findByRole('button', { name: /^Add keywords/ });
    emit({ type: 'deleted', at: 1, conversationId: 'c3' });
    expect(screen.queryByRole('button', { name: /^Add keywords/ })).toBeNull();
  });

  it('lets someone who is not an admin read the chats, not delete them', async () => {
    const { client } = fakeClient(CHATS);
    const user = userEvent.setup();
    render(<Harness client={client} canRun={false} />);
    await user.click(await screen.findByRole('button', { name: 'History' }));
    await screen.findByRole('button', { name: /^Review the links/ });
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
  });

  it('deletes a chat once: its row waits while the delete is out, and comes back if it fails', async () => {
    const { client } = fakeClient(CHATS);
    let refuse: (reason: Error) => void = () => undefined;
    client.remove.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { refuse = reject; }));
    const user = userEvent.setup();
    render(<Harness client={client} />);
    await user.click(await screen.findByRole('button', { name: 'History' }));
    const trash = await screen.findByRole<HTMLButtonElement>('button', { name: 'Delete: Review the links' });
    await user.click(trash);
    await user.click(within(screen.getByRole('dialog', { name: 'Delete this chat?' })).getByRole('button', { name: 'Delete' }));
    expect(trash.disabled).toBe(true);
    expect(trash.getAttribute('aria-busy')).toBe('true');
    // It cannot be confirmed again, nor picked for a bulk delete.
    await user.click(trash);
    expect(screen.queryByRole('dialog', { name: 'Delete this chat?' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Select' }));
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Pick: Review the links' }).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Select' }));
    expect(client.remove).toHaveBeenCalledTimes(1);
    await act(async () => { refuse(new Error('the agent is still answering: cancel the turn first')); await Promise.resolve(); });
    expect((await screen.findByRole('alert')).textContent).toContain('cancel the turn first');
    const again = screen.getByRole<HTMLButtonElement>('button', { name: 'Delete: Review the links' });
    await waitFor(() => { expect(again.disabled).toBe(false); });
    expect(again.getAttribute('aria-busy')).toBeNull();
  });
});
