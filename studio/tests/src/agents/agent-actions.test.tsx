// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askAgent, useAsk } from '../../../src/agents/agent-ask';
import { draftPrompt, NOTE_ACTIONS, SELECTION_ACTIONS } from '../../../src/agents/actions';
import { cleanFolder } from '../../../src/agents/context-labels';
import { editorPlaces } from '../../../src/agents/editor-place';
import type { MessageSelection } from '../../../src/api/agents';
import { AGENTS, fakeClient, Harness, summary } from '../../support/agents-ui';

const NOTE = 'content/docs/guide/first-look.mdx';
const SELECTION: MessageSelection = { lines: [5, 5], source: 'A first look.', text: 'first look' };
const atNote = { note: NOTE, selection: null, caret: null, mentions: [], attachments: [] };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('notes-studio:agent-panel', 'true');
});
afterEach(() => {
  cleanup();
  act(() => { editorPlaces.set(null); });
});

const place = (selection: MessageSelection | null) => { act(() => { editorPlaces.set({ note: NOTE, selection, caret: selection === null ? 3 : null }); }); };

async function openChat(conversation = summary({ status: 'done', endedMs: Date.now() })) {
  const { client, emit } = fakeClient([conversation]);
  const user = userEvent.setup();
  render(<Harness client={client} />);
  await user.click(await screen.findByRole('button', { name: 'History' }));
  await user.click(await screen.findByRole('button', { name: /^Tighten the intro/ }));
  return { client, emit, user };
}

describe('agent actions (#86)', () => {
  it('offers the selection actions with a selection, the note actions without one', async () => {
    const { user } = await openChat();
    place(SELECTION);
    const selected = screen.getByRole('group', { name: 'Do with the selection' });
    expect(within(selected).getAllByRole('button').map((button) => button.textContent)).toEqual(SELECTION_ACTIONS.map((each) => each.label));
    await user.click(screen.getByRole('button', { name: 'Leave the selection out of this message' }));
    const note = screen.getByRole('group', { name: 'Do with the note' });
    expect(within(note).getAllByRole('button').map((button) => button.textContent)).toEqual(['Fill frontmatter', 'Suggest links', 'Diagram']);
  });

  it('sends an action to the author chat waiting for a message, with the selection, keeping what was typed', async () => {
    const { client, user } = await openChat();
    place(SELECTION);
    const box = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' });
    await user.type(box, 'half a thought');
    await user.click(screen.getByRole('button', { name: 'Tighten' }));
    expect(client.message).toHaveBeenCalledWith('c1', SELECTION_ACTIONS[1].prompt, { ...atNote, selection: SELECTION });
    expect(box.value).toBe('half a thought');
  });

  it('starts a new author chat for an action while the chat answers', async () => {
    const { client, user } = await openChat(summary({ status: 'running' }));
    place(null);
    await user.click(screen.getByRole('button', { name: 'Suggest links' }));
    expect(client.message).not.toHaveBeenCalled();
    expect(client.start).toHaveBeenCalledWith('claude', 'author', NOTE_ACTIONS[1].prompt, { ...atNote, caret: 3 });
  });

  it('starts a new author chat while a message is on its way to this one, and keeps the draft there', async () => {
    // The message is taken, but the stream has not said the chat is answering yet.
    const { client, user } = await openChat();
    place(null);
    const box = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' });
    await user.type(box, 'Go on{Enter}');
    await user.type(box, 'next @help');
    await screen.findByRole('option', { name: /helper/ });
    await user.keyboard('{Enter}');
    const input = document.querySelector<HTMLInputElement>('.studio-agent-composer input[type=file]');
    if (input === null) throw new Error('no file input');
    await user.upload(input, new File(['# Brief'], 'brief.md'));
    await screen.findByText('brief.md');
    await user.click(screen.getByRole('button', { name: 'Diagram' }));
    expect(client.message).toHaveBeenCalledTimes(1);
    expect(client.start).toHaveBeenCalledWith('claude', 'author', NOTE_ACTIONS[2].prompt, { ...atNote, caret: 3 });
    // The new chat's composer holds the message being written, chips too.
    await vi.waitFor(() => { expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' }).value).toBe('next '); });
    expect(screen.getByText('@lib/helper.ts')).toBeTruthy();
    expect(screen.getByText('brief.md')).toBeTruthy();
  });

  it('leaves the mentions and attachments for the message being written', async () => {
    const { client, user } = await openChat();
    place(SELECTION);
    const box = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' });
    await user.type(box, 'see @help');
    await screen.findByRole('option', { name: /helper/ });
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Rewrite' }));
    expect(client.message).toHaveBeenCalledWith('c1', SELECTION_ACTIONS[0].prompt, { ...atNote, selection: SELECTION });
    expect(screen.getByText('@lib/helper.ts')).toBeTruthy();
    expect(box.value).toBe('see ');
  });

  it('offers no action in a reviewer chat, nor in a new reviewer chat', async () => {
    const { user } = await openChat(summary({ status: 'done', endedMs: Date.now(), role: 'reviewer' }));
    place(SELECTION);
    expect(screen.queryByRole('group', { name: 'Do with the selection' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(screen.getByRole('group', { name: 'Do with the selection' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Reviewer' }));
    expect(screen.queryByRole('group', { name: 'Do with the selection' })).toBeNull();
  });

  it('runs one action at a time', async () => {
    const { client, user } = await openChat();
    let finish: () => void = () => undefined;
    client.message.mockImplementationOnce(() => new Promise((resolve) => { finish = () => { resolve(summary({ turns: 2 })); }; }));
    place(SELECTION);
    await user.click(screen.getByRole('button', { name: 'Rewrite' }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Expand' }).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    expect(client.message).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); await Promise.resolve(); });
  });

  it('fills the frontmatter when the note header asks, while the panel takes asks', async () => {
    function Probe() {
      return <span data-testid="can-ask">{String(useAsk().can)}</span>;
    }
    const { client } = fakeClient([summary({ status: 'done', endedMs: Date.now() })]);
    const { unmount } = render(<><Harness client={client} /><Probe /></>);
    // Once the agents are known: an author agent can run.
    await vi.waitFor(() => { expect(screen.getByTestId('can-ask').textContent).toBe('true'); });
    place(SELECTION);
    act(() => { askAgent('frontmatter'); askAgent('frontmatter'); });
    // A new chat: none is on screen. Asked twice at once, it goes once.
    expect(client.start).toHaveBeenCalledWith('claude', 'author', NOTE_ACTIONS[0].prompt, atNote);
    expect(client.start).toHaveBeenCalledTimes(1);
    unmount();
    render(<Probe />);
    expect(screen.getByTestId('can-ask').textContent).toBe('false');
  });

  it('shows Fill pending while its ask goes, and takes no ask without an author agent', async () => {
    function Probe() {
      const ask = useAsk();
      return <span data-testid="ask">{`${String(ask.can)} ${ask.pending ?? '-'}`}</span>;
    }
    const { client } = fakeClient([summary({ status: 'done', endedMs: Date.now() })]);
    let finish: () => void = () => undefined;
    client.start.mockImplementationOnce(() => new Promise((resolve) => { finish = () => { resolve(summary({ id: 'new' })); }; }));
    const { unmount } = render(<><Harness client={client} /><Probe /></>);
    await screen.findByRole('button', { name: 'History' });
    place(null);
    act(() => { askAgent('frontmatter'); });
    await vi.waitFor(() => { expect(screen.getByTestId('ask').textContent).toBe('true frontmatter'); });
    await act(async () => { finish(); await Promise.resolve(); });
    await vi.waitFor(() => { expect(screen.getByTestId('ask').textContent).toBe('true -'); });
    unmount();

    const none = fakeClient();
    none.client.agents.mockResolvedValue(AGENTS.map((agent) => ({ ...agent, available: false })));
    render(<><Harness client={none.client} /><Probe /></>);
    await screen.findByText(/No agent can run here/);
    expect(screen.getByTestId('ask').textContent).toBe('false -');
  });

  it('drafts a new note from the form: its path from folder and title, with the composer\'s context', async () => {
    const { client, user } = await openChat();
    place(null);
    await user.click(screen.getByRole('button', { name: 'New note' }));
    const form = within(screen.getByRole('group', { name: 'New note' }));
    expect(form.getByRole<HTMLInputElement>('textbox', { name: 'Folder' }).value).toBe('guide');
    const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Send' });
    expect(send.disabled).toBe(true);
    await user.type(form.getByRole('textbox', { name: 'Title' }), 'Photon và Spark SQL');
    expect(form.getByLabelText('Path').textContent).toBe('content/docs/guide/photon-va-spark-sql.mdx');
    await user.type(form.getByRole('textbox', { name: 'Outline' }), '- What it is');
    await user.type(form.getByRole('textbox', { name: 'Links to read' }), 'https://docs.example.com/photon');
    await vi.waitFor(() => { expect(send.disabled).toBe(false); });
    await user.click(send);
    const prompt = draftPrompt({ path: 'content/docs/guide/photon-va-spark-sql.mdx', title: 'Photon và Spark SQL', outline: '- What it is', urls: ['https://docs.example.com/photon'] });
    expect(client.start).toHaveBeenCalledWith('claude', 'author', prompt, { ...atNote, caret: 3 });
    expect(screen.queryByRole('group', { name: 'New note' })).toBeNull();
  });

  it('sends no draft before its path is looked up', async () => {
    const { client, user } = await openChat();
    place(null);
    let answer: () => void = () => undefined;
    client.mentions.mockImplementation((query: string) => new Promise((resolve) => { answer = () => { resolve(query.endsWith('.mdx') ? [] : []); }; }));
    await user.click(screen.getByRole('button', { name: 'New note' }));
    const form = within(screen.getByRole('group', { name: 'New note' }));
    await user.type(form.getByRole('textbox', { name: 'Title' }), 'Fresh');
    const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Send' });
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '{Enter}');
    expect(send.disabled).toBe(true);
    expect(client.start).not.toHaveBeenCalled();
    await vi.waitFor(() => { expect(client.mentions).toHaveBeenCalledWith('content/docs/guide/fresh.mdx'); });
    await act(async () => { answer(); await Promise.resolve(); });
    await vi.waitFor(() => { expect(send.disabled).toBe(false); });
  });

  it('will not draft over a note that is already at the path', async () => {
    const { client, user } = await openChat();
    place(null);
    await user.click(screen.getByRole('button', { name: 'New note' }));
    const form = within(screen.getByRole('group', { name: 'New note' }));
    await user.clear(form.getByRole('textbox', { name: 'Folder' }));
    await user.type(form.getByRole('textbox', { name: 'Folder' }), 'content/docs/guide/');
    await user.type(form.getByRole('textbox', { name: 'Title' }), 'First look');
    expect(form.getByLabelText('Path').textContent).toBe('content/docs/guide/first-look.mdx');
    expect(await form.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send' }).disabled).toBe(true);
    expect(client.start).not.toHaveBeenCalled();
  });
});

describe('action messages', () => {
  it('takes a folder relative to content/docs, as typed or with it', () => {
    expect(cleanFolder(' /guide//deep/ ')).toBe('guide/deep');
    expect(cleanFolder('content/docs/guide')).toBe('guide');
    expect(cleanFolder('content/docs')).toBe('');
    expect(cleanFolder('guide/../x')).toBeNull();
  });

  it('asks for a suggestion, never a write, in every edit action', () => {
    for (const each of [...SELECTION_ACTIONS, ...NOTE_ACTIONS]) expect(each.prompt, each.id).toMatch(/propose_edit/);
    expect(NOTE_ACTIONS[0].prompt).toContain('note_vocabulary');
    expect(NOTE_ACTIONS[1].prompt).toContain('related_notes');
    // Diagram changes the note's diagram when it shows one, from either row.
    for (const prompt of [NOTE_ACTIONS[2].prompt, SELECTION_ACTIONS[6].prompt]) {
      expect(prompt).toMatch(/diagram_read.*diagram_update/s);
      expect(prompt).toContain('diagram_create');
      expect(prompt).toContain('diagram_render_png');
    }
    expect(SELECTION_ACTIONS[6].prompt).toContain('of the selected lines');
  });

  it('drafts without an outline from the sources, and lists the links to read', () => {
    const prompt = draftPrompt({ path: 'content/docs/a/b.mdx', title: 'B', outline: ' ', urls: [] });
    expect(prompt).toContain('Work out its outline from the sources.');
    expect(prompt).not.toContain('Read these sources');
    expect(draftPrompt({ path: 'content/docs/a/b.mdx', title: 'B', outline: '', urls: ['https://x.dev'] })).toContain('Read these sources:\n- https://x.dev');
  });
});
