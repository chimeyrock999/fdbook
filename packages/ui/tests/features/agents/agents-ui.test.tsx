// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClient, Harness, summary } from '#tests/support/agents-ui.tsx';

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
    expect(client.start).toHaveBeenCalledWith('claude', 'author', 'Tighten the intro', null);
    await waitFor(() => { expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' }).value).toBe(''); });

    const started = summary({ id: 'new' });
    emit({ type: 'start', at: 0, conversation: started, conversationId: 'new' });
    emit({ type: 'turn', at: 0, prompt: 'Tighten the intro', by: 'octocat', conversationId: 'new' });
    emit(say('Shortened it.'));
    emit({ type: 'write', at: 2, path: 'content/docs/intro.mdx', bytes: 40, conversationId: 'new' });
    const view = within(screen.getByRole('region', { name: 'Chat with Claude Code' }));
    expect(view.getByText('Tighten the intro', { selector: '.studio-agent-prompt' })).toBeTruthy();
    expect(view.getByText('Shortened it.')).toBeTruthy();
    expect(view.getByText('Opus 5.5').getAttribute('title')).toBe('Opus 5.5');
    await user.click(view.getByRole('button', { name: 'View diff' }));
    expect(onOpenDiff).toHaveBeenCalledWith('content/docs/intro.mdx');
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
    expect(client.message).toHaveBeenCalledWith('c1', 'Shorter still', null);
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
    expect(client.start).toHaveBeenCalledWith('claude', 'author', 'Line one\nline two', null);
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

  it('shows New note and New chat as icons named for assistive tech, so the header fits the panel (#161)', async () => {
    const { client } = fakeClient();
    render(<Harness client={client} />);
    await screen.findByText('Claude Code', { selector: '.studio-agent-who' });
    for (const name of ['New note', 'New chat']) {
      const button = screen.getByRole('button', { name });
      expect(button.textContent).toBe('');
      expect(button.getAttribute('title')).toBe(name);
    }
    expect(screen.getByRole('button', { name: 'History' }).textContent.trim()).toBe('History');
  });

  it('chats on main read only, with no New note, and links the change request an agent opened from there (#167)', async () => {
    const { client, emit } = fakeClient();
    const user = userEvent.setup();
    render(<Harness client={client} inCr={false} />);
    expect(await screen.findByText(/^Read only on main\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New note' })).toBeNull();
    expect(screen.getByRole('button', { name: 'New chat' })).toBeTruthy();
    expect(screen.getByText(/on main the agent only reads, and opens a change request to make it/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Reviewer' }));
    expect(screen.getByText('Ask for a review of what is on main: the agent reads and answers.')).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Is the intro right?{Enter}');
    expect(client.start).toHaveBeenCalledWith('codex', 'reviewer', 'Is the intro right?', null);
    const started = summary({ id: 'new', role: 'reviewer' });
    emit({ type: 'start', at: 0, conversation: started, conversationId: 'new' });
    emit({ type: 'turn', at: 0, prompt: 'Is the intro right?', by: 'octocat', conversationId: 'new' });
    emit({ type: 'handoff', at: 1, slug: 'fix-the-intro', name: 'Fix the intro', branch: 'cr/fix-the-intro', url: 'http://127.0.0.1/?cr=fix-the-intro&chat=c9', chat: 'c9', conversationId: 'new' });
    const view = within(screen.getByRole('region', { name: 'Chat with Claude Code' }));
    expect(view.getByText('Continued in a change request')).toBeTruthy();
    expect(view.getByText('cr/fix-the-intro')).toBeTruthy();
    expect(view.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/?cr=fix-the-intro&chat=c9');
  });

  it('says which chat on main a change request\'s chat carries on from', async () => {
    const { client, emit } = fakeClient();
    render(<Harness client={client} />);
    await screen.findByText('Claude Code', { selector: '.studio-agent-who' });
    emit({ type: 'start', at: 0, conversation: summary({ id: 'c9' }), conversationId: 'c9' });
    emit({ type: 'turn', at: 0, prompt: 'Fix the intro.', by: 'octocat', from: 'm1', conversationId: 'c9' });
    const view = within(await screen.findByRole('region', { name: 'Chat with Claude Code' }));
    expect(view.getByText(/Carried on from a chat on main/)).toBeTruthy();
    expect(view.getByRole('link', { name: 'Open it' }).getAttribute('href')).toBe('/?chat=m1');
  });

  it('offers only reading to someone who is not an admin', async () => {
    const { client } = fakeClient([summary({ status: 'done' })]);
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

describe('pending actions in the chat', () => {
  beforeEach(() => { localStorage.setItem('notes-studio:agent-panel', 'true'); });

  const ask = {
    id: 'a1',
    toolCall: { toolCallId: 't1', title: 'Run npm test', kind: 'execute' as const, rawInput: { command: 'npm test' } },
    options: [
      { optionId: 'once', name: 'Allow once', kind: 'allow_once' as const },
      { optionId: 'no', name: 'Reject', kind: 'reject_once' as const },
    ],
  };

  // A promise the test settles.
  function deferred<T = void>() {
    let resolve: (value: T) => void = () => undefined;
    let reject: (reason: Error) => void = () => undefined;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }

  // A running chat, open in the panel, that asked `ask`.
  async function asked() {
    const running = summary();
    const view = fakeClient([running]);
    render(<Harness client={view.client} />);
    await screen.findByRole('textbox', { name: 'Message' });
    view.emit({ type: 'start', at: 0, conversation: running, conversationId: 'c1' });
    view.emit({ type: 'turn', at: 0, prompt: 'Tighten the intro', by: 'octocat', conversationId: 'c1' });
    view.emit({ type: 'permission', at: Date.now(), ask, conversationId: 'c1' });
    return view;
  }

  it('asks in the chat, not in a dialog over the page, and sends one answer however often it is picked', async () => {
    const { client, emit } = await asked();
    const answer = deferred();
    client.answer.mockReturnValueOnce(answer.promise);
    expect(screen.queryByRole('dialog')).toBeNull();
    const card = within(screen.getByRole('region', { name: 'Claude Code asks: Run npm test' }));
    expect(card.getByText('npm test')).toBeTruthy();
    expect(card.getByText(/Rejected in (5:00|4:59)/)).toBeTruthy();
    expect(screen.getByLabelText('1 question waiting')).toBeTruthy();
    // No thinking while the agent waits for an answer.
    expect(screen.queryByText(/is thinking/)).toBeNull();

    const allow = card.getByRole<HTMLButtonElement>('button', { name: 'Allow once' });
    fireEvent.click(allow);
    fireEvent.click(allow);
    fireEvent.click(card.getByRole('button', { name: 'Reject' }));
    expect(client.answer).toHaveBeenCalledTimes(1);
    expect(client.answer).toHaveBeenCalledWith('c1', 'a1', 'once');
    expect(allow.disabled).toBe(true);
    expect(allow.getAttribute('aria-busy')).toBe('true');
    expect(card.getByRole<HTMLButtonElement>('button', { name: 'Reject' }).disabled).toBe(true);
    // Keys do nothing: there is no dialog to close.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(client.answer).toHaveBeenCalledTimes(1);

    await act(async () => { answer.resolve(); await answer.promise; });
    // The server has it: a line, before the stream says so.
    expect(screen.queryByRole('region', { name: 'Claude Code asks: Run npm test' })).toBeNull();
    expect(screen.getByText('Allow once', { selector: '.studio-agent-tool-state' })).toBeTruthy();
    emit({ type: 'answer', at: Date.now(), id: 'a1', optionId: 'once', by: 'octocat', conversationId: 'c1' });
    expect(screen.getByText('Allow once by octocat')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows nothing when the question was answered already, and a toast when the answer fails', async () => {
    const { client } = await asked();
    client.answer.mockRejectedValueOnce(Object.assign(new Error('this question was already answered'), { status: 409 }));
    const card = within(screen.getByRole('region', { name: 'Claude Code asks: Run npm test' }));
    fireEvent.click(card.getByRole('button', { name: 'Reject' }));
    await waitFor(() => { expect(screen.queryByRole('region', { name: 'Claude Code asks: Run npm test' })).toBeNull(); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the question when the answer fails, and says why in a toast', async () => {
    const { client } = await asked();
    client.answer.mockRejectedValueOnce(Object.assign(new Error('the Studio server is gone'), { status: 502 }));
    const card = within(screen.getByRole('region', { name: 'Claude Code asks: Run npm test' }));
    fireEvent.click(card.getByRole('button', { name: 'Allow once' }));
    expect((await screen.findByRole('alert')).textContent).toContain('the Studio server is gone');
    expect(card.getByRole<HTMLButtonElement>('button', { name: 'Allow once' }).disabled).toBe(false);
  });

  it('says where a question waits when another chat is shown, and opens the panel on a new one', async () => {
    const other = summary({ id: 'c2', prompt: 'Review the intro', status: 'done' });
    const running = summary();
    const { client, emit } = fakeClient([running, other]);
    localStorage.setItem('notes-studio:agent-panel', 'false');
    const user = userEvent.setup();
    render(<Harness client={client} />);
    await screen.findByRole('button', { name: 'Show the agent panel' });
    emit({ type: 'start', at: 0, conversation: running, conversationId: 'c1' });
    emit({ type: 'permission', at: Date.now(), ask, conversationId: 'c1' });
    // The panel opens on the chat that asks.
    expect(await screen.findByRole('region', { name: 'Claude Code asks: Run npm test' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'History' }));
    await user.click(await screen.findByRole('button', { name: /^Review the intro/ }));
    expect(screen.queryByRole('region', { name: 'Claude Code asks: Run npm test' })).toBeNull();
    expect(screen.getByText('Claude Code is asking in another chat')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByRole('region', { name: 'Claude Code asks: Run npm test' })).toBeTruthy();
  });

  it('shows a message on its way at once, the agent thinking until it answers, and the message back in the box if it did not go', async () => {
    const done = summary({ status: 'done', endedMs: Date.now() });
    const { client, emit } = fakeClient([done]);
    client.read.mockResolvedValue({ conversation: done, seq: 0, events: [{ type: 'start', at: 0, conversation: done }, { type: 'turn', at: 0, prompt: 'Tighten the intro', by: 'octocat' }] });
    const sent = deferred<ReturnType<typeof summary>>();
    client.message.mockReturnValueOnce(sent.promise).mockRejectedValueOnce(new Error('the agent is still answering: wait for it, or cancel the turn'));
    const user = userEvent.setup();
    render(<Harness client={client} />);
    await user.click(await screen.findByRole('button', { name: 'History' }));
    await user.click(await screen.findByRole('button', { name: /^Tighten the intro/ }));
    const box = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' });
    await user.type(box, 'Shorter still{Enter}');
    await user.keyboard('{Enter}');
    expect(client.message).toHaveBeenCalledTimes(1);
    // The box is free at once; the message shows on its way.
    expect(box.value).toBe('');
    expect(screen.getByText('Shorter still', { selector: '.studio-agent-prompt[data-pending]' })).toBeTruthy();
    expect(screen.getByText('Sending…')).toBeTruthy();

    await act(async () => { sent.resolve(summary({ turns: 2 })); await sent.promise; });
    emit({ type: 'summary', at: 1, conversation: { ...done, status: 'running', turns: 2 }, conversationId: 'c1' });
    expect(screen.getByText(/Claude Code is thinking/)).toBeTruthy();
    // The stream brings the message: one of it, not on its way any more.
    emit({ type: 'turn', at: 2, prompt: 'Shorter still', by: 'octocat', conversationId: 'c1' });
    expect(screen.getAllByText('Shorter still', { selector: '.studio-agent-prompt' })).toHaveLength(1);
    expect(screen.queryByText('Sending…')).toBeNull();
    expect(screen.getByText(/Claude Code is thinking/)).toBeTruthy();
    emit(say('Shortened.', 'c1'));
    expect(screen.queryByText(/is thinking/)).toBeNull();

    const turn = { status: 'done' as const, error: null, cost: null, usage: null };
    emit({ type: 'end', at: 3, conversation: { ...done, turns: 2 }, turn, conversationId: 'c1' });
    await user.type(box, 'Again{Enter}');
    expect((await screen.findByRole('alert')).textContent).toContain('the agent is still answering');
    expect(box.value).toBe('Again');
    expect(screen.queryByText('Sending…')).toBeNull();
  });

  it('shows the new chat on its way while the agent starts', async () => {
    const { client } = fakeClient();
    const started = deferred<ReturnType<typeof summary>>();
    client.start.mockReturnValueOnce(started.promise);
    const user = userEvent.setup();
    render(<Harness client={client} />);
    await screen.findByText('Claude Code', { selector: '.studio-agent-who' });
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Tighten the intro{Enter}');
    expect(screen.getByText('Tighten the intro', { selector: '.studio-agent-prompt[data-pending]' })).toBeTruthy();
    expect(screen.getByText(/Claude Code is starting/)).toBeTruthy();
    await act(async () => { started.resolve(summary({ id: 'new' })); await started.promise; });
    // The chat shows before the stream lists it.
    const view = within(screen.getByRole('region', { name: 'Chat with Claude Code' }));
    expect(view.getByText('Tighten the intro', { selector: '.studio-agent-prompt[data-pending]' })).toBeTruthy();
    expect(view.queryByText('Loading the chat…')).toBeNull();
  });

  it('cancels a turn once, and says Cancelling until the turn ends', async () => {
    const running = summary();
    const { client, emit } = fakeClient([running]);
    const cancelled = deferred();
    client.cancel.mockReturnValueOnce(cancelled.promise);
    render(<Harness client={client} />);
    await screen.findByRole('textbox', { name: 'Message' });
    emit({ type: 'start', at: 0, conversation: running, conversationId: 'c1' });
    const cancel = await screen.findByRole<HTMLButtonElement>('button', { name: 'Cancel' });
    fireEvent.click(cancel);
    fireEvent.click(cancel);
    expect(client.cancel).toHaveBeenCalledTimes(1);
    expect(cancel.disabled).toBe(true);
    await act(async () => { cancelled.resolve(); await cancelled.promise; });
    // Asked: the button waits for the turn's end.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Cancel/ }).disabled).toBe(true);
    const turn = { status: 'cancelled' as const, error: null, cost: null, usage: null };
    emit({ type: 'end', at: 3, conversation: { ...running, status: 'cancelled' }, turn, conversationId: 'c1' });
    expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
    expect(client.cancel).toHaveBeenCalledTimes(1);
  });

  it('takes a cancel the server says came too late (409) for done', async () => {
    const { client } = fakeClient([summary()]);
    client.cancel.mockRejectedValueOnce(Object.assign(new Error('no turn is going on in this conversation'), { status: 409 }));
    render(<Harness client={client} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(client.cancel).toHaveBeenCalledTimes(1); });
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('reads a chat it started, and drops the start once the list has it, so a deleted chat goes', async () => {
    const { client, emit } = fakeClient();
    const user = userEvent.setup();
    render(<Harness client={client} />);
    await screen.findByText('Claude Code', { selector: '.studio-agent-who' });
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Tighten the intro{Enter}');
    // Should the stream miss its start, the chat is read.
    await waitFor(() => { expect(client.read).toHaveBeenCalledWith('new'); });
    const chat = summary({ id: 'new', status: 'done' });
    emit({ type: 'start', at: 0, conversation: chat, conversationId: 'new' });
    expect(screen.getByRole('region', { name: 'Chat with Claude Code' })).toBeTruthy();
    emit({ type: 'deleted', at: 1, conversationId: 'new' });
    expect(screen.queryByRole('region', { name: 'Chat with Claude Code' })).toBeNull();
  });

  it('cancels each chat on its own: a second chat\'s Cancel goes while the first one waits', async () => {
    const a = summary({ id: 'c1', prompt: 'First chat' });
    const b = summary({ id: 'c2', prompt: 'Second chat' });
    const { client, emit } = fakeClient([a, b]);
    client.cancel.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    render(<Harness client={client} />);
    await screen.findByRole('textbox', { name: 'Message' });
    emit({ type: 'start', at: 0, conversation: a, conversationId: 'c1' });
    emit({ type: 'start', at: 0, conversation: b, conversationId: 'c2' });
    for (const prompt of ['First chat', 'Second chat']) {
      await user.click(screen.getByRole('button', { name: 'History' }));
      await user.click(await screen.findByRole('button', { name: new RegExp(`^${prompt}`) }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    }
    expect(client.cancel.mock.calls).toEqual([['c1'], ['c2']]);
    await user.click(screen.getByRole('button', { name: 'History' }));
    await user.click(await screen.findByRole('button', { name: /^First chat/ }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Cancel/ }).disabled).toBe(true);
  });
});
