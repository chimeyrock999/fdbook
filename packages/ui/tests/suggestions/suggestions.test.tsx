// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { blocksOf, hunksOf } from '@fdbook/shared/hunks.ts';
import { anchorAt } from '@fdbook/shared/anchors.ts';
import type { ProposalHunk, ProposalsClient, ProposalView, Thread, ThreadState } from '#api/proposals.ts';
import { pluginsExtension } from '#editor/extensions.ts';
import { placeAll } from '#suggestions/places.ts';
import { sourceSuggestions } from '#suggestions/source.ts';
import { SuggestionBar, VisualSuggestions, type NoteReview } from '#suggestions/Suggestions.tsx';
import { NoteThreads } from '#review/ThreadMarks.tsx';
import { useNoteSuggestions } from '#suggestions/useNoteSuggestions.ts';
import { useProposals } from '#suggestions/useProposals.ts';
import { createSuggestionLayer, type SuggestionLayer } from '#suggestions/visual.ts';
import { ToastStack } from '#actions/ToastStack.tsx';
import { mountVisual, stubLayout } from '#tests/support/visual-editor.tsx';

const PATH = 'content/docs/guide.mdx';
const NOTE = '---\ntitle: Guide\n---\n\n# Guide\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n';

// A proposal of `next` against NOTE, as the server would list it.
function proposal(next: string, id = 'p1', base = NOTE): ProposalView {
  const hunks = hunksOf(base, next).map((hunk, index): ProposalHunk => ({ id: String(index + 1), ...hunk, decided: null, state: 'open', from: null, to: null }));
  return { id, path: PATH, by: { kind: 'run', runId: 'r1', agent: 'claude', model: 'Opus 5.5' }, summary: 'Tighten the guide', createdMs: 1, hunks, mtimeMs: 1, stale: false, done: false };
}

// A thread from a reviewer on block `block` of `text`, or on the whole note.
export function thread(block: number | null, body = 'Say more.', text = NOTE, extra: Partial<Thread> = {}): Thread {
  return {
    id: `t${String(body.length)}`, path: PATH, anchor: block === null ? null : anchorAt(blocksOf(text), block), orphaned: false, severity: 'nit', rule: null, state: 'open', suggestion: null,
    comments: [{ id: 'c1', body, by: { kind: 'run', runId: 'r2', agent: 'codex', model: 'gpt-5', role: 'reviewer' }, createdMs: 2 }], createdMs: 2, updatedMs: 2, ...extra,
  };
}

afterEach(cleanup);

describe('placeAll', () => {
  const edited = NOTE.replace('First paragraph.', 'First, tightened.').replace('Third paragraph.\n', 'Third paragraph.\n\nA new last one.\n');

  it('places each hunk on its blocks: the frontmatter is block 0, an insertion holds none', () => {
    const { hunks, lost, parsed } = placeAll(NOTE, [proposal(edited)]);
    expect(parsed).toBe(true);
    expect(lost).toEqual([]);
    expect(hunks.map((hunk) => [hunk.first, hunk.count, hunk.stale])).toEqual([[2, 1, false], [5, 0, false]]);
  });

  it('follows the text as it is now, shows a changed hunk as stale where a rebase puts it, and loses one with no anchors', () => {
    const now = NOTE.replace('First paragraph.', 'First, by a person.');
    const { hunks } = placeAll(now, [proposal(edited)]);
    expect(hunks.map((hunk) => [hunk.first, hunk.count, hunk.stale])).toEqual([[2, 1, true], [5, 0, false]]);
    const gone = NOTE.replace('# Guide', '# X').replace('First paragraph.', 'Y.').replace('Second paragraph.', 'Z.');
    expect(placeAll(gone, [proposal(edited)]).lost.map((each) => each.hunk.id)).toEqual(['1']);
  });

  it('leaves decided hunks out, places nothing in a note that does not parse, and finds threads by their anchor', () => {
    const decided = proposal(edited);
    decided.hunks[0] = { ...decided.hunks[0], decided: 'accepted' };
    expect(placeAll(NOTE, [decided]).hunks).toHaveLength(1);
    expect(placeAll(`${NOTE}<Broken\n`, [decided]).parsed).toBe(false);
    const moved = NOTE.replace('# Guide\n\n', '# Guide\n\nAn intro.\n\n');
    const gone = NOTE.replace('Third paragraph.\n', '');
    const { threads } = placeAll(moved.replace('Second paragraph.', 'Second paragraph, edited.'), [], [thread(3), thread(null, 'On the note.'), { ...thread(4, 'Lost one.'), anchor: anchorAt(blocksOf(NOTE), 4) }]);
    expect(threads.map((each) => each.block)).toEqual([4, null, 5]);
    // A block gone from the text being typed is gone, whatever the server said last.
    expect(placeAll(gone, [], [thread(4, 'Lost one.')]).threads.map((each) => each.block)).toEqual([null]);
  });
});

function review(proposals: ProposalView[], act = vi.fn(() => Promise.resolve())) {
  return {
    proposals,
    threads: [] as Thread[],
    act,
    openThread: vi.fn(() => Promise.resolve()),
    replyThread: vi.fn(() => Promise.resolve()),
    moveThread: vi.fn<(id: string, state: ThreadState, body: string) => Promise<void>>(() => Promise.resolve()),
  } satisfies NoteReview;
}

// A thread's mark drawn into the editor.
function mark(prose: HTMLElement) {
  const found = prose.querySelector<HTMLElement>('.studio-suggest-comment');
  if (found?.querySelector('button') == null) throw new Error('no thread mark yet');
  return found;
}

// The bar over `text`, deciding as NoteEditor does.
function Bar({ decide, text }: { decide: NoteReview; text: string }) {
  const suggestions = useNoteSuggestions(decide, text);
  return <SuggestionBar placement={suggestions.placement} focus={suggestions.focus} onStep={() => undefined} decisions={suggestions.decisions} />;
}

describe('SuggestionBar', () => {
  it('counts the suggestions and the stale ones, and accepts only the open ones, per proposal', async () => {
    const user = userEvent.setup();
    const first = proposal(NOTE.replace('First paragraph.', 'One.').replace('Third paragraph.', 'Three.'), 'p1');
    const second = proposal(NOTE.replace('# Guide', '# The guide'), 'p2');
    const now = NOTE.replace('Third paragraph.', 'Third, by a person.');
    const decide = review([first, second]);
    render(<Bar decide={decide} text={now} />);
    const bar = screen.getByRole('region', { name: 'Suggestions' });
    expect(within(bar).getByText('3 suggestions')).toBeTruthy();
    expect(within(bar).getByText('1 stale')).toBeTruthy();
    expect(within(bar).getByText('2 proposals')).toBeTruthy();
    await user.click(within(bar).getByRole('button', { name: /Accept all/ }));
    expect(decide.act.mock.calls).toEqual([['p2', 'accept', ['1']], ['p1', 'accept', ['1']]]);
    await user.click(within(bar).getByRole('button', { name: 'Reject all' }));
    expect(decide.act.mock.calls.slice(2)).toEqual([['p2', 'reject', ['1']], ['p1', 'reject', ['1', '2']]]);
  });

  it('shows nothing once every suggestion is decided', () => {
    const { container } = render(<Bar decide={review([])} text={NOTE} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('suggestions in Source', () => {
  it('marks the lines a hunk replaces and puts what it adds under them, with its actions', () => {
    const next = NOTE.replace('Second paragraph.', 'Second, rewritten.');
    const placement = placeAll(NOTE, [proposal(next)]);
    const act = vi.fn(() => Promise.resolve());
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: NOTE, extensions: [sourceSuggestions(NOTE, placement.hunks, act)] }) });
    const removed = [...view.dom.querySelectorAll('.studio-suggest-line-removed')].map((line) => line.textContent);
    expect(removed).toEqual(['Second paragraph.']);
    const widget = view.dom.querySelector<HTMLElement>('.studio-suggest-source');
    expect(widget?.querySelector('pre')?.textContent).toBe('Second, rewritten.');
    widget?.querySelector<HTMLButtonElement>('[aria-label="Accept suggestion"]')?.click();
    expect(act).toHaveBeenCalledWith(placement.hunks[0], 'accept');
    view.destroy();
  });

  it('sends one request per click until it is answered, so a double click does not decide twice', async () => {
    const placement = placeAll(NOTE, [proposal(NOTE.replace('Second paragraph.', 'Two.'))]);
    let answer: () => void = () => undefined;
    const act = vi.fn(() => new Promise<void>((resolve) => { answer = resolve; }));
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: NOTE, extensions: [sourceSuggestions(NOTE, placement.hunks, act)] }) });
    const accept = view.dom.querySelector<HTMLButtonElement>('[aria-label="Accept suggestion"]');
    const reject = view.dom.querySelector<HTMLButtonElement>('[aria-label="Reject suggestion"]');
    accept?.click();
    accept?.click();
    reject?.click();
    expect(act).toHaveBeenCalledTimes(1);
    expect([accept?.disabled, reject?.disabled]).toEqual([true, true]);
    answer();
    await waitFor(() => { expect(accept?.disabled).toBe(false); });
    view.destroy();
  });

  it('draws nothing while the editor holds other text', () => {
    const placement = placeAll(NOTE, [proposal(NOTE.replace('Second paragraph.', 'Two.'))]);
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: `${NOTE}More.\n`, extensions: [sourceSuggestions(NOTE, placement.hunks, null)] }) });
    expect(view.dom.querySelector('.studio-suggest-source')).toBeNull();
    view.destroy();
  });
});

// The real Visual editor with the suggestion layer, as NoteEditor mounts it.
function Layer({ layer, text, decide }: { layer: SuggestionLayer; text: string; decide: NoteReview }) {
  const { placement, focus, decisions } = useNoteSuggestions(decide, text);
  const threads = { open: decide.openThread, reply: decide.replyThread, move: decide.moveThread };
  return <VisualSuggestions layer={layer} placement={placement} focus={focus} readOnly={false} decisions={decisions} text={text} threads={threads} threadFocus={null} />;
}

// Made with the editor root, which takes its plugin as an extension.
function mountWithLayer(decide: NoteReview) {
  const layer = createSuggestionLayer();
  return mountVisual(NOTE, { extensions: [pluginsExtension('studioNote', [layer.plugin])], extra: () => <Layer layer={layer} text={NOTE} decide={decide} /> });
}

describe('suggestions in Visual', () => {
  beforeAll(stubLayout);

  it('marks the replaced block in the editor, draws the proposed one after it, and decides it', async () => {
    const next = NOTE.replace('Second paragraph.', 'Second, **rewritten**.');
    const decide = review([proposal(next)]);
    decide.threads = [thread(2)];
    const { prose } = await mountWithLayer(decide);
    await waitFor(() => { expect(prose.querySelector('.studio-suggest-removed')?.textContent).toBe('Second paragraph.'); });
    const card = await waitFor(() => {
      const found = prose.querySelector<HTMLElement>('.studio-suggest-card');
      if (!found?.querySelector('strong')) throw new Error('no card yet');
      return found;
    });
    expect(card.dataset.focus).toBe('true');
    expect(card.querySelector('strong')?.textContent).toBe('rewritten');
    // The card sits right after the block it replaces.
    expect(prose.querySelector('.studio-suggest-removed')?.nextElementSibling).toBe(card);
    // The thread opens from its mark, on the page, over the note.
    await act(async () => { within(mark(prose)).getByRole('button', { name: '1 thread, from Codex' }).click(); await Promise.resolve(); });
    const threadCard = within(await screen.findByRole('dialog', { name: 'Review thread' }));
    expect(threadCard.getByText('gpt-5')).toBeTruthy();
    await act(async () => { threadCard.getByRole('button', { name: 'Resolve' }).click(); await Promise.resolve(); });
    expect(decide.moveThread).toHaveBeenCalledWith('t9', 'resolved', '');
    await act(async () => { within(card).getByRole('button', { name: 'Accept suggestion' }).click(); await Promise.resolve(); });
    expect(decide.act).toHaveBeenCalledWith('p1', 'accept', ['1']);
  });

  it('moves a thread once while the request is out, asks a rejection why, and says why it failed in a toast', async () => {
    const decide = review([]);
    decide.threads = [thread(2)];
    let fail: (reason: Error) => void = () => undefined;
    decide.moveThread.mockImplementation(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    render(<ToastStack />);
    const { prose } = await mountWithLayer(decide);
    await act(async () => { within(await waitFor(() => mark(prose))).getByRole('button', { name: /thread/ }).click(); await Promise.resolve(); });
    const card = within(await screen.findByRole('dialog', { name: 'Review thread' }));
    await act(async () => { card.getByRole('button', { name: 'Reject' }).click(); await Promise.resolve(); });
    expect(decide.moveThread).not.toHaveBeenCalled();
    expect(card.getByRole('textbox', { name: 'Reply' }).getAttribute('placeholder')).toMatch(/Say why/);
    await userEvent.type(card.getByRole('textbox', { name: 'Reply' }), 'It is right as it is.');
    const reject = card.getByRole('button', { name: 'Reject' });
    await act(async () => { reject.click(); reject.click(); await Promise.resolve(); });
    expect(decide.moveThread).toHaveBeenCalledTimes(1);
    expect(decide.moveThread).toHaveBeenCalledWith('t9', 'rejected', 'It is right as it is.');
    await act(async () => { fail(new Error('a person cannot take a thread from resolved to rejected')); await Promise.resolve(); });
    expect((await screen.findByRole('alert')).textContent).toContain('cannot take a thread');
    // The reason stays, to send again.
    expect(card.getByRole('textbox', { name: 'Reply' })).toHaveProperty('value', 'It is right as it is.');
  });
});

describe('NoteThreads', () => {
  it('lists threads on the whole note and those whose block is gone, opens one, and offers no moves to a reader', async () => {
    const actions = { reply: vi.fn(() => Promise.resolve()), move: vi.fn(() => Promise.resolve()) };
    const orphan = { ...thread(4, 'Rewrite the opening.'), orphaned: true };
    const placement = placeAll(NOTE.replace('Third paragraph.\n', ''), [], [orphan, thread(null, 'On the note.')]);
    const { rerender } = render(<NoteThreads placement={placement} readOnly={false} actions={actions} focus={null} />);
    const list = within(screen.getByRole('list', { name: 'Threads on the note' }));
    expect(list.getByText('Block gone: Third paragraph.')).toBeTruthy();
    await act(async () => { list.getByRole('button', { name: /Rewrite the opening/ }).click(); await Promise.resolve(); });
    const card = within(screen.getByRole('dialog', { name: 'Review thread' }));
    expect(card.getByText('Block gone')).toBeTruthy();
    await act(async () => { card.getByRole('button', { name: 'Resolve' }).click(); await Promise.resolve(); });
    expect(actions.move).toHaveBeenCalledWith(orphan.id, 'resolved', '');
    rerender(<NoteThreads placement={placement} readOnly actions={actions} focus={null} />);
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Reply' })).toBeNull();
  });
});

describe('useProposals', () => {
  it('throws a failed action to the button that sent it, and says why a reload failed in a toast', async () => {
    const other = { ...proposal(NOTE.replace('First paragraph.', 'One.'), 'p2'), path: 'content/docs/other.mdx' };
    let listing: () => Promise<ProposalView[]> = () => Promise.resolve([proposal(NOTE.replace('First paragraph.', 'One.')), other]);
    const client = {
      list: () => listing(),
      threads: () => Promise.resolve([]),
      listDeletes: () => Promise.resolve([]),
      subscribe: (_merge: unknown, reopened: () => void) => { reopened(); return () => undefined; },
      act: () => Promise.reject(new Error('nothing left to decide in these hunks')),
    } as unknown as ProposalsClient;
    render(<ToastStack />);
    const { result } = renderHook(() => useProposals(client, true));
    await waitFor(() => { expect(result.current.proposals).toHaveLength(2); });
    await expect(result.current.act('p2', 'accept', ['1'])).rejects.toThrow('nothing left to decide in these hunks');
    expect(screen.queryByRole('alert')).toBeNull();
    listing = () => Promise.reject(new Error('offline'));
    renderHook(() => useProposals(client, true));
    expect((await screen.findByRole('alert')).textContent).toContain('offline');
  });

  it('keeps each thread as the stream and its own answers have it, the later copy winning', async () => {
    const first = thread(null, 'One.');
    let onThread: (thread: Thread) => void = () => undefined;
    const moved = { ...first, state: 'resolved' as const, updatedMs: 10 };
    const client = {
      list: () => Promise.resolve([]),
      threads: () => Promise.resolve([first]),
      listDeletes: () => Promise.resolve([]),
      subscribe: (_merge: unknown, reopened: () => void, given: typeof onThread) => { onThread = given; reopened(); return () => undefined; },
      move: vi.fn(() => Promise.resolve(moved)),
    } as unknown as ProposalsClient;
    const { result } = renderHook(() => useProposals(client, true));
    await waitFor(() => { expect(result.current.threads).toHaveLength(1); });
    await act(() => result.current.moveThread(first.id, 'resolved', ''));
    expect(result.current.threads[0].state).toBe('resolved');
    // An older copy from the stream, after the answer: kept out.
    act(() => { onThread({ ...first, updatedMs: 5 }); });
    expect(result.current.threads[0].state).toBe('resolved');
    act(() => { onThread(thread(null, 'Another one.')); });
    expect(result.current.threads).toHaveLength(2);
  });
});
