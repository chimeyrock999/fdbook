// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionDialog } from '../../../src/agents/PermissionDialog';
import { fakeClient, Harness, summary } from '../../support/agents-ui';

beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

const say = (text: string, conversationId = 'new') => ({ type: 'update' as const, at: 1, update: { sessionUpdate: 'agent_message_chunk' as const, content: { type: 'text' as const, text } }, conversationId });

describe('agent picker', () => {
  it('picks an agent per role with its logo, greys out one that cannot run, and keeps the choice', async () => {
    const { client } = fakeClient();
    const user = userEvent.setup();
    const { unmount } = render(<Harness client={client} />);
    const picker = await screen.findByRole('button', { name: 'Agents: Claude Code writes, Codex reviews' });
    expect(picker.querySelector('[data-agent="claude"] svg')).not.toBeNull();
    await user.click(picker);
    const menu = screen.getByRole('menu', { name: 'Agents' });
    const reviewer = within(within(menu).getByRole('group', { name: 'Reviewer' }));
    expect(reviewer.getByRole<HTMLButtonElement>('menuitemradio', { name: /Hermes Agent/ }).disabled).toBe(true);
    expect(reviewer.getByText(/hermes is not installed/)).toBeTruthy();
    await user.click(reviewer.getByRole('menuitemradio', { name: /omp/ }));
    expect(screen.getByRole('button', { name: 'Agents: Claude Code writes, omp reviews' })).toBeTruthy();
    unmount();
    render(<Harness client={fakeClient().client} />);
    expect(await screen.findByRole('button', { name: 'Agents: Claude Code writes, omp reviews' })).toBeTruthy();
  });

  it('shows and hides the panel, remembered, with the number of agents answering', async () => {
    const { client, emit } = fakeClient();
    const user = userEvent.setup();
    render(<Harness client={client} />);
    await user.click(screen.getByRole('button', { name: 'Show the agent panel' }));
    expect(screen.getByRole('complementary', { name: 'Agent' })).toBeTruthy();
    expect(localStorage.getItem('notes-studio:agent-panel')).toBe('true');
    emit({ type: 'start', at: 0, conversation: summary(), conversationId: 'c1' });
    expect(screen.getByLabelText('1 running')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close the agent panel' }));
    expect(screen.queryByRole('complementary', { name: 'Agent' })).toBeNull();
  });
});

describe('agent chat', () => {
  beforeEach(() => { localStorage.setItem('notes-studio:agent-panel', 'true'); });

  it('starts a chat on Enter with the agent picked for the role, and follows what it does', async () => {
    const { client, emit } = fakeClient();
    const onOpenDiff = vi.fn();
    const user = userEvent.setup();
    render(<Harness client={client} onOpenDiff={onOpenDiff} />);
    await screen.findByText('Claude Code', { selector: '.studio-agent-who' });
    await user.click(screen.getByRole('button', { name: 'Reviewer' }));
    expect(screen.getByText('A reviewer reads only: it cannot change files.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Author' }));
    const box = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' });
    await user.type(box, 'Tighten the intro{Enter}');
    expect(client.start).toHaveBeenCalledWith('claude', 'author', 'Tighten the intro');
    await waitFor(() => { expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' }).value).toBe(''); });

    const started = summary({ id: 'new' });
    emit({ type: 'start', at: 0, conversation: started, conversationId: 'new' });
    emit({ type: 'turn', at: 0, prompt: 'Tighten the intro', by: 'octocat', conversationId: 'new' });
    emit(say('Shortened it.'));
    emit({ type: 'write', at: 2, path: 'content/notes/intro.mdx', bytes: 40, conversationId: 'new' });
    const view = within(screen.getByRole('region', { name: 'Chat with Claude Code' }));
    expect(view.getByText('Tighten the intro', { selector: '.studio-agent-prompt' })).toBeTruthy();
    expect(view.getByText('Shortened it.')).toBeTruthy();
    expect(view.getByText('Opus 5.5').getAttribute('title')).toBe('Opus 5.5');
    await user.click(view.getByRole('button', { name: 'View diff' }));
    expect(onOpenDiff).toHaveBeenCalledWith('content/notes/intro.mdx');
    await user.click(view.getByRole('button', { name: 'Cancel' }));
    expect(client.cancel).toHaveBeenCalledWith('new');
    const turn = { status: 'cancelled' as const, error: null, cost: { amount: 0.31, currency: 'USD' }, usage: null };
    emit({ type: 'end', at: 3000, conversation: { ...started, status: 'cancelled', endedMs: Date.now() }, turn, conversationId: 'new' });
    expect(view.getByText('Cancelled')).toBeTruthy();
    expect(view.getByText('Turn 1 · cancelled · 3s · $0.31')).toBeTruthy();
  });

  it('sends the next message to the same chat on Enter, and nothing while the agent answers', async () => {
    const done = summary({ status: 'done', endedMs: Date.now() });
    const { client, emit } = fakeClient([done]);
    const user = userEvent.setup();
    render(<Harness client={client} />);
    await user.click(await screen.findByRole('button', { name: 'History' }));
    await user.click(await screen.findByRole('button', { name: /^Tighten the intro/ }));
    const box = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' });
    expect(screen.getByText('Claude Code · Author', { selector: '.studio-agent-who' })).toBeTruthy();
    await user.type(box, 'Shorter still{Enter}');
    expect(client.message).toHaveBeenCalledWith('c1', 'Shorter still');
    await waitFor(() => { expect(box.value).toBe(''); });
    expect(document.activeElement).toBe(box);

    emit({ type: 'summary', at: 1, conversation: { ...done, status: 'running', turns: 2 }, conversationId: 'c1' });
    await user.type(box, 'And again{Enter}');
    expect(client.message).toHaveBeenCalledTimes(1);
    expect(box.value).toBe('And again');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send' }).disabled).toBe(true);
  });

  it('reads a chat another page sent a message to, keeping what streams in meanwhile', async () => {
    const idle = summary({ status: 'done' });
    const { client, emit } = fakeClient([idle]);
    let finish: (read: Awaited<ReturnType<typeof client.read>>) => void = () => undefined;
    client.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<Harness client={client} />);
    await screen.findByRole('textbox', { name: 'Message' });
    emit({ type: 'turn', at: 10, prompt: 'Shorter still', by: 'hubot', conversationId: 'c1', seq: 5 });
    await waitFor(() => { expect(client.read).toHaveBeenCalledWith('c1'); });
    emit({ type: 'summary', at: 11, conversation: { ...idle, status: 'running', turns: 2 }, conversationId: 'c1', seq: 6 });
    emit({ ...say('Done.', 'c1'), seq: 7 });
    finish({ conversation: idle, seq: 5, events: [{ type: 'start', at: 0, conversation: idle }, { type: 'turn', at: 0, prompt: 'Tighten the intro', by: null }, { type: 'turn', at: 10, prompt: 'Shorter still', by: 'hubot' }] });
    const view = within(await screen.findByRole('region', { name: 'Chat with Claude Code' }));
    expect(await view.findByText('Done.')).toBeTruthy();
    expect(view.getByText('Shorter still', { selector: '.studio-agent-prompt' })).toBeTruthy();
  });

  it('adds a line on Shift+Enter, and only confirms an IME\'s text on its Enter', async () => {
    const { client } = fakeClient();
    const user = userEvent.setup();
    render(<Harness client={client} />);
    const box = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Message' });
    await screen.findByText('Claude Code', { selector: '.studio-agent-who' });
    await user.type(box, 'Line one{Shift>}{Enter}{/Shift}line two');
    expect(box.value).toBe('Line one\nline two');
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 });
    expect(client.start).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(client.start).toHaveBeenCalledWith('claude', 'author', 'Line one\nline two');
  });

  it('marks where a new session took over without the earlier turns, and shows no model it was not told', async () => {
    const conversation = summary({ id: 'c1', status: 'done', model: null, turns: 2 });
    const { client } = fakeClient([conversation]);
    client.read.mockResolvedValueOnce({
      conversation,
      seq: 5,
      events: [
        { type: 'start', at: 0, conversation },
        { type: 'turn', at: 0, prompt: 'First', by: null },
        { type: 'session', at: 1, how: 'new', sessionId: 's1' },
        { type: 'turn', at: 5, prompt: 'Second', by: null },
        { type: 'session', at: 6, how: 'fresh', sessionId: 's2' },
      ],
    });
    const user = userEvent.setup();
    render(<Harness client={client} />);
    await user.click(await screen.findByRole('button', { name: 'History' }));
    await user.click(await screen.findByRole('button', { name: /^Tighten the intro/ }));
    const view = within(await screen.findByRole('region', { name: 'Chat with Claude Code' }));
    expect(await view.findByText(/could not pick the session up again/)).toBeTruthy();
    expect(view.queryByText(/Default \(recommended\)/)).toBeNull();
    expect(screen.getByRole('region', { name: 'Chat with Claude Code' }).querySelector('.studio-agent-model')).toBeNull();
  });

  it('reads the chats again when the event stream connects again, so a turn that ended meanwhile ends here too', async () => {
    const { client, emit, reconnect } = fakeClient();
    render(<Harness client={client} />);
    await screen.findByRole('textbox', { name: 'Message' });
    emit({ type: 'start', at: 0, conversation: summary(), conversationId: 'c1' });
    expect(screen.getByLabelText('1 running')).toBeTruthy();
    const done = summary({ status: 'done', endedMs: Date.now() });
    client.conversations.mockResolvedValueOnce([done]);
    client.read.mockResolvedValueOnce({ conversation: done, events: [{ type: 'start', at: 0, conversation: summary() }, { type: 'end', at: 1, conversation: done, turn: { status: 'done', error: null, cost: null, usage: null } }], seq: 2 });
    reconnect();
    await waitFor(() => { expect(screen.queryByLabelText('1 running')).toBeNull(); });
  });

  it('says what a reviewer that cannot be held to reading may still do', async () => {
    localStorage.setItem('notes-studio:agents', JSON.stringify({ author: 'claude', reviewer: 'omp' }));
    const user = userEvent.setup();
    render(<Harness client={fakeClient().client} />);
    await screen.findByText('Claude Code', { selector: '.studio-agent-who' });
    await user.click(screen.getByRole('button', { name: 'Reviewer' }));
    expect(screen.getByText(/omp cannot be held to reading/)).toBeTruthy();
  });

  it('offers no chat on main, and only reading to someone who is not an admin', async () => {
    const { client } = fakeClient([summary({ status: 'done' })]);
    const { unmount } = render(<Harness client={client} inCr={false} />);
    expect(await screen.findByText(/Agents work in a change request, never on main/)).toBeTruthy();
    expect(client.subscribe).not.toHaveBeenCalled();
    unmount();
    const user = userEvent.setup();
    render(<Harness client={client} canRun={false} />);
    expect(await screen.findByText(/Starting an agent needs admin access/)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'History' }));
    await user.click(await screen.findByRole('button', { name: /^Tighten the intro/ }));
    expect(screen.getByRole('region', { name: 'Chat with Claude Code' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
  });
});

describe('permission dialog', () => {
  const ask = {
    id: 'a1',
    toolCall: { toolCallId: 't1', title: 'Run npm test', kind: 'execute' as const, rawInput: { command: 'npm test' } },
    options: [
      { optionId: 'once', name: 'Allow once', kind: 'allow_once' as const },
      { optionId: 'no', name: 'Reject', kind: 'reject_once' as const },
    ],
  };

  it('shows the command and the agent\'s options, and answers with the one picked', async () => {
    const onAnswer = vi.fn();
    const user = userEvent.setup();
    render(<PermissionDialog conversation={summary()} ask={ask} at={Date.now()} onAnswer={onAnswer} />);
    const dialog = screen.getByRole('dialog', { name: 'Claude Code asks: Run npm test' });
    expect(within(dialog).getByText('npm test')).toBeTruthy();
    expect(within(dialog).getByText(/Rejected in 5:00|Rejected in 4:59/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Allow once' }));
    expect(onAnswer).toHaveBeenLastCalledWith('once');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(onAnswer).toHaveBeenLastCalledWith('no');
  });

  it('rejects when closed', () => {
    const onAnswer = vi.fn();
    render(<PermissionDialog conversation={summary()} ask={ask} at={Date.now()} onAnswer={onAnswer} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onAnswer).toHaveBeenCalledWith(null);
  });
});
