// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorPlaces } from '../../../src/agents/editor-place';
import type { Attachment, MessageSelection } from '../../../src/api/agents';
import { fakeClient, Harness, summary } from '../../support/agents-ui';

const NOTE = 'content/notes/guide/first-look.mdx';
const SELECTION: MessageSelection = { lines: [5, 7], source: 'A first look.\n\nMore.', text: 'first look' };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('notes-studio:agent-panel', 'true');
});
afterEach(() => {
  cleanup();
  act(() => { editorPlaces.set(null); });
});

const place = (selection: MessageSelection | null, caret: number | null = null) => { act(() => { editorPlaces.set({ note: NOTE, selection, caret }); }); };

async function openChat() {
  const { client, emit } = fakeClient([summary({ status: 'done', endedMs: Date.now() })]);
  const user = userEvent.setup();
  render(<Harness client={client} />);
  await user.click(await screen.findByRole('button', { name: 'History' }));
  await user.click(await screen.findByRole('button', { name: /^Tighten the intro/ }));
  const box = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' });
  const chips = () => within(screen.getByLabelText('Sent with the message', { selector: '.studio-agent-composer .studio-agent-chips' }));
  return { client, emit, user, box, chips };
}

describe('message context in the composer (#86)', () => {
  it('sends the open note and the caret\'s line when nothing is selected', async () => {
    const { client, user, box, chips } = await openChat();
    place(null, 3);
    expect(chips().getByText('guide/first-look.mdx:L3')).toBeTruthy();
    expect(chips().queryByRole('button')).toBeNull();
    await user.type(box, 'Go on{Enter}');
    expect(client.message).toHaveBeenCalledWith('c1', 'Go on', { note: NOTE, selection: null, caret: 3, mentions: [], attachments: [] });
  });

  it('shows the selection as path and lines only, and × leaves it out of this message', async () => {
    const { client, user, box, chips } = await openChat();
    place(SELECTION);
    const chip = chips().getByText('guide/first-look.mdx:L5-L7');
    expect(chip.closest('.studio-agent-chip')?.textContent).toBe('guide/first-look.mdx:L5-L7');
    await user.type(box, 'Tighten{Enter}');
    expect(client.message).toHaveBeenLastCalledWith('c1', 'Tighten', { note: NOTE, selection: SELECTION, caret: null, mentions: [], attachments: [] });

    await user.click(chips().getByRole('button', { name: 'Leave the selection out of this message' }));
    expect(chips().queryByText('guide/first-look.mdx:L5-L7')).toBeNull();
    expect(chips().getByText('guide/first-look.mdx')).toBeTruthy();
    await user.type(box, 'Whole note{Enter}');
    expect(client.message).toHaveBeenLastCalledWith('c1', 'Whole note', { note: NOTE, selection: null, caret: null, mentions: [], attachments: [] });
    // Left out of that message only.
    await waitFor(() => { expect(chips().getByText('guide/first-look.mdx:L5-L7')).toBeTruthy(); });
  });

  it('shows a new selection after one was left out', async () => {
    const { user, chips } = await openChat();
    place(SELECTION);
    await user.click(chips().getByRole('button', { name: 'Leave the selection out of this message' }));
    place({ ...SELECTION, lines: [9, 9] });
    expect(chips().getByText('guide/first-look.mdx:L9')).toBeTruthy();
  });

  it('mentions with @: the arrows move, Enter picks, and the @word goes into a chip', async () => {
    const { client, user, box, chips } = await openChat();
    await user.type(box, 'Compare with @');
    const list = await screen.findByRole('listbox', { name: 'Mention' });
    expect(within(list).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Notes', 'Assets', 'Repo files']);
    await user.type(box, 'h');
    await waitFor(() => { expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual(['public/notes/guide/chart.png', 'lib/helper.ts']); });
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.queryByRole('listbox', { name: 'Mention' })).toBeNull();
    expect(box.value).toBe('Compare with ');
    expect(chips().getByText('@lib/helper.ts')).toBeTruthy();
    await user.type(box, 'it{Enter}');
    expect(client.message).toHaveBeenLastCalledWith('c1', 'Compare with it', { note: null, selection: null, caret: null, mentions: [{ kind: 'file', path: 'lib/helper.ts' }], attachments: [] });
    expect(screen.queryByLabelText('Sent with the message', { selector: '.studio-agent-composer .studio-agent-chips' })).toBeNull();
  });

  it('waits for the list of the @word typed before Enter picks', async () => {
    const { client, user, box, chips } = await openChat();
    await user.type(box, '@');
    await screen.findByRole('option', { name: /first-look/ });
    let answer: (found: { kind: 'file'; path: string }[]) => void = () => undefined;
    vi.mocked(client.mentions).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    await user.type(box, 'help');
    await waitFor(() => { expect(client.mentions).toHaveBeenLastCalledWith('help'); });
    // Still the list for "@": Enter neither picks its first entry nor sends.
    await user.keyboard('{Enter}');
    expect(client.message).not.toHaveBeenCalled();
    expect(screen.queryByText('@guide/first-look.mdx')).toBeNull();
    await act(async () => { answer([{ kind: 'file', path: 'lib/helper.ts' }]); await Promise.resolve(); });
    await user.keyboard('{Enter}');
    expect(chips().getByText('@lib/helper.ts')).toBeTruthy();
  });

  it('sends a selection too long to carry as its lines alone', async () => {
    const { client, user, box } = await openChat();
    place({ lines: [1, 2000], source: 'x'.repeat(40_001), text: 'x' });
    await user.type(box, 'Tighten it all{Enter}');
    expect(client.message).toHaveBeenLastCalledWith('c1', 'Tighten it all', { note: NOTE, selection: { lines: [1, 2000], source: '', text: '' }, caret: null, mentions: [], attachments: [] });
  });

  it('gives the text and its chips back when the message is refused, with the reason in a toast', async () => {
    const { client, user, box, chips } = await openChat();
    vi.mocked(client.message).mockRejectedValueOnce(new Error('the agent is still answering'));
    await user.type(box, 'Compare @');
    await screen.findByRole('option', { name: /helper/ });
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await user.type(box, 'please{Enter}');
    expect(await screen.findByText('the agent is still answering')).toBeTruthy();
    await waitFor(() => { expect(box.value).toBe('Compare please'); });
    expect(chips().getByText('@lib/helper.ts')).toBeTruthy();
  });

  it('closes the list on Escape, and an IME\'s Enter neither picks nor sends', async () => {
    const { client, user, box } = await openChat();
    await user.type(box, '@first');
    await screen.findByRole('option', { name: /first-look/ });
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 });
    expect(screen.getByRole('listbox', { name: 'Mention' })).toBeTruthy();
    expect(client.message).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: 'Mention' })).toBeNull();
    expect(box.value).toBe('@first');
  });

  it('attaches a document once at a time, and refuses one over 10 MB', async () => {
    const { client, user, box, chips } = await openChat();
    let finish: (attachment: Attachment) => void = () => undefined;
    vi.mocked(client.attach).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const input = document.querySelector<HTMLInputElement>('.studio-agent-composer input[type=file]');
    if (input === null) throw new Error('no file input');
    await user.upload(input, new File(['# Brief'], 'brief.md'));
    const attachButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Attach a document' });
    expect(attachButton.disabled).toBe(true);
    await user.type(box, 'Read it{Enter}');
    expect(client.message).not.toHaveBeenCalled();
    await act(async () => { finish({ id: 'a1', name: 'brief.md', size: 7 }); await Promise.resolve(); });
    expect(chips().getByText('brief.md')).toBeTruthy();
    expect(attachButton.disabled).toBe(false);

    // Dropped while another goes up: it waits its turn.
    let second: (attachment: Attachment) => void = () => undefined;
    vi.mocked(client.attach).mockImplementationOnce(() => new Promise((resolve) => { second = resolve; }));
    await user.upload(input, new File(['a'], 'a.txt'));
    const form = box.closest('form');
    if (form === null) throw new Error('no form');
    fireEvent.drop(form, { dataTransfer: { files: [new File(['b'], 'b.txt')], types: ['Files'] } });
    await act(async () => { second({ id: 'a2', name: 'a.txt', size: 1 }); await Promise.resolve(); });
    await waitFor(() => { expect(chips().getByText('b.txt')).toBeTruthy(); });
    expect(chips().getByText('a.txt')).toBeTruthy();
    await user.click(chips().getByRole('button', { name: 'Remove a.txt' }));
    await user.click(chips().getByRole('button', { name: 'Remove b.txt' }));

    const big = new File(['x'], 'huge.pdf');
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    await user.upload(input, big);
    expect(await screen.findByText(/huge\.pdf is larger than 10 MB/)).toBeTruthy();
    expect(client.attach).toHaveBeenCalledTimes(3);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(client.message).toHaveBeenLastCalledWith('c1', 'Read it', { note: null, selection: null, caret: null, mentions: [], attachments: [{ id: 'a1', name: 'brief.md', size: 7 }] });
  });

  it('shows what went with each message in the thread', async () => {
    const { emit } = await openChat();
    emit({ type: 'turn', at: 2, prompt: 'Tighten', by: 'octocat', context: { note: NOTE, selection: SELECTION, caret: null, mentions: [{ kind: 'asset', path: 'public/notes/guide/chart.png' }], attachments: [] }, conversationId: 'c1' });
    const sent = await screen.findByLabelText('Sent with the message', { selector: '.studio-agent-prompt-context' });
    expect(within(sent).getAllByText(/./, { selector: '.studio-agent-chip-label' }).map((label) => label.textContent)).toEqual(['guide/first-look.mdx:L5-L7', '@public/notes/guide/chart.png']);
    expect(within(sent).queryByRole('button')).toBeNull();
  });
});
