// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, type RefObject } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { hunksOf } from '../../../server/proposals/hunks';
import type { NoteComment, ProposalHunk, ProposalsClient, ProposalView } from '../../../src/api/proposals';
import { useEditorPlugin } from '../../../src/editor/decorations';
import { placeAll } from '../../../src/suggestions/places';
import { sourceSuggestions } from '../../../src/suggestions/source';
import { NoteComments, SuggestionBar, VisualSuggestions, type NoteReview } from '../../../src/suggestions/Suggestions';
import { useNoteSuggestions } from '../../../src/suggestions/useNoteSuggestions';
import { useProposals } from '../../../src/suggestions/useProposals';
import { createSuggestionLayer } from '../../../src/suggestions/visual';
import { ToastStack } from '../../../src/actions/ToastStack';
import { mountVisual, stubLayout } from '../../support/visual-editor';

const PATH = 'content/notes/guide.mdx';
const NOTE = '---\ntitle: Guide\n---\n\n# Guide\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n';

// A proposal of `next` against NOTE, as the server would list it.
function proposal(next: string, id = 'p1', base = NOTE): ProposalView {
  const hunks = hunksOf(base, next).map((hunk, index): ProposalHunk => ({ id: String(index + 1), ...hunk, decided: null, state: 'open', from: null, to: null }));
  return { id, path: PATH, by: { kind: 'run', runId: 'r1', agent: 'claude', model: 'Opus 5.5' }, summary: 'Tighten the guide', createdMs: 1, hunks, mtimeMs: 1, stale: false, done: false };
}

const comment = (block: { index: number; text: string } | null, body = 'Say more.'): NoteComment => ({ id: `c${String(body.length)}`, path: PATH, block, body, by: { kind: 'run', runId: 'r2', agent: 'codex', model: null }, createdMs: 2 });

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

  it('leaves decided hunks out, places nothing in a note that does not parse, and finds comments by their block text', () => {
    const decided = proposal(edited);
    decided.hunks[0] = { ...decided.hunks[0], decided: 'accepted' };
    expect(placeAll(NOTE, [decided]).hunks).toHaveLength(1);
    expect(placeAll(`${NOTE}<Broken\n`, [decided]).parsed).toBe(false);
    const moved = NOTE.replace('# Guide\n\n', '# Guide\n\nAn intro.\n\n');
    const { comments } = placeAll(moved, [], [comment({ index: 3, text: 'Second paragraph.' }), comment(null, 'On the note.'), comment({ index: 9, text: 'Gone.' }, 'Lost one.')]);
    expect(comments.map((each) => each.block)).toEqual([4, null, null]);
  });
});

function review(proposals: ProposalView[], act = vi.fn(() => Promise.resolve()), resolveComment = vi.fn<(id: string) => Promise<void>>(() => Promise.resolve())): NoteReview & { act: typeof act; resolveComment: typeof resolveComment } {
  return { proposals, comments: [], act, resolveComment };
}

// The comment bubble drawn into the editor.
function bubble(prose: HTMLElement) {
  const found = prose.querySelector<HTMLElement>('.studio-suggest-comment');
  if (found === null) throw new Error('no comment bubble yet');
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
function Layer({ container, text, decide }: { container: RefObject<HTMLElement | null>; text: string; decide: NoteReview }) {
  const layer = useMemo(createSuggestionLayer, []);
  useEditorPlugin(container, layer.plugin);
  const { placement, focus, decisions } = useNoteSuggestions(decide, text);
  return <VisualSuggestions layer={layer} placement={placement} focus={focus} readOnly={false} decisions={decisions} onResolveComment={decide.resolveComment} />;
}

describe('suggestions in Visual', () => {
  beforeAll(stubLayout);

  it('marks the replaced block in the editor, draws the proposed one after it, and decides it', async () => {
    const next = NOTE.replace('Second paragraph.', 'Second, **rewritten**.');
    const decide = review([proposal(next)]);
    decide.comments = [comment({ index: 2, text: 'First paragraph.' })];
    const { prose } = await mountVisual(NOTE, { extra: (container) => <Layer container={container} text={NOTE} decide={decide} /> });
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
    const commentUi = within(bubble(prose));
    const commentButton = commentUi.getByRole('button', { name: 'Comment from Codex' });
    await act(async () => { commentButton.click(); await Promise.resolve(); });
    await act(async () => { commentUi.getByRole('button', { name: 'Resolve feedback' }).click(); await Promise.resolve(); });
    expect(decide.resolveComment).toHaveBeenCalledWith('c9');
    await act(async () => { within(card).getByRole('button', { name: 'Accept suggestion' }).click(); await Promise.resolve(); });
    expect(decide.act).toHaveBeenCalledWith('p1', 'accept', ['1']);
  });

  it('resolves feedback once while the request is out, and says why it failed in a toast', async () => {
    const decide = review([]);
    decide.comments = [comment({ index: 2, text: 'First paragraph.' })];
    let fail: (reason: Error) => void = () => undefined;
    decide.resolveComment.mockImplementation(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    render(<ToastStack />);
    const { prose } = await mountVisual(NOTE, { extra: (container) => <Layer container={container} text={NOTE} decide={decide} /> });
    const commentUi = within(await waitFor(() => bubble(prose)));
    await act(async () => { commentUi.getByRole('button', { name: 'Comment from Codex' }).click(); await Promise.resolve(); });
    const resolve = commentUi.getByRole('button', { name: 'Resolve feedback' });
    await act(async () => { resolve.click(); resolve.click(); await Promise.resolve(); });
    expect(decide.resolveComment).toHaveBeenCalledTimes(1);
    expect(commentUi.getByRole('button', { name: /Resolv/ })).toHaveProperty('disabled', true);
    await act(async () => { fail(new Error('no such comment: c9')); await Promise.resolve(); });
    expect((await screen.findByRole('alert')).textContent).toContain('no such comment: c9');
    expect(commentUi.getByRole('button', { name: 'Resolve feedback' })).toHaveProperty('disabled', false);
  });
});

describe('NoteComments', () => {
  it('resolves a comment on the note as a whole, or on a block that is gone, and offers no Resolve to a reader', async () => {
    const resolveComment = vi.fn<(id: string) => Promise<void>>(() => Promise.resolve());
    const loose = comment({ index: 9, text: 'Gone.' }, 'Rewrite the opening.');
    const placement = placeAll(NOTE, [], [loose]);
    const { rerender } = render(<NoteComments placement={placement} readOnly={false} onResolve={resolveComment} />);
    const item = within(screen.getByRole('list', { name: 'Comments on the note' }));
    expect(item.getByText('Rewrite the opening.')).toBeTruthy();
    await act(async () => { item.getByRole('button', { name: 'Resolve feedback' }).click(); await Promise.resolve(); });
    expect(resolveComment).toHaveBeenCalledWith(loose.id);
    rerender(<NoteComments placement={placement} readOnly onResolve={resolveComment} />);
    expect(screen.queryByRole('button', { name: 'Resolve feedback' })).toBeNull();
  });
});

describe('useProposals', () => {
  it('throws a failed action to the button that sent it, and says why a reload failed in a toast', async () => {
    const other = { ...proposal(NOTE.replace('First paragraph.', 'One.'), 'p2'), path: 'content/notes/other.mdx' };
    let listing: () => Promise<ProposalView[]> = () => Promise.resolve([proposal(NOTE.replace('First paragraph.', 'One.')), other]);
    const client = {
      list: () => listing(),
      comments: () => Promise.resolve([]),
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

  it('drops a resolved comment, its own and one another client resolved', async () => {
    const comments = [comment(null, 'One.'), comment(null, 'Two two.'), comment(null, 'Three three three.')];
    let resolved: (comment: { id: string }) => void = () => undefined;
    const resolveComment = vi.fn(() => Promise.resolve());
    const client = {
      list: () => Promise.resolve([]),
      comments: () => Promise.resolve(comments),
      listDeletes: () => Promise.resolve([]),
      subscribe: (_merge: unknown, reopened: () => void, _onComment: unknown, onResolved: typeof resolved) => { resolved = onResolved; reopened(); return () => undefined; },
      resolveComment,
    } as unknown as ProposalsClient;
    const { result } = renderHook(() => useProposals(client, true));
    await waitFor(() => { expect(result.current.comments).toHaveLength(3); });
    await act(() => result.current.resolveComment(comments[0].id));
    expect(resolveComment).toHaveBeenCalledWith(comments[0].id);
    act(() => { resolved({ id: comments[1].id }); });
    expect(result.current.comments.map((each) => each.id)).toEqual([comments[2].id]);
  });
});
