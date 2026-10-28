// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hunksOf } from '../../../server/proposals/hunks';
import { ToastStack } from '../../../src/actions/ToastStack';
import type { ProposalHunk, ProposalView } from '../../../src/api/proposals';
import { SuggestionBar, type NoteReview } from '../../../src/suggestions/Suggestions';
import { LANDING_MS, useNoteSuggestions } from '../../../src/suggestions/useNoteSuggestions';

const PATH = 'content/notes/guide.mdx';
const NOTE = '---\ntitle: Guide\n---\n\n# Guide\n\nFirst paragraph.\n\nA middle one.\n\nAnd one more.\n\nSecond paragraph.\n';
const NEXT = NOTE.replace('First paragraph.', 'One.').replace('Second paragraph.', 'Two.');

function proposal(decided: ProposalHunk['decided'][] = [null, null], id = 'p1'): ProposalView {
  const hunks = hunksOf(NOTE, NEXT).map((hunk, index): ProposalHunk => ({ id: String(index + 1), ...hunk, decided: decided[index] ?? null, state: 'open', from: null, to: null }));
  return { id, path: PATH, by: { kind: 'run', runId: 'r1', agent: 'claude', model: 'Opus 5.5' }, summary: null, createdMs: 1, hunks, mtimeMs: 1, stale: false, done: false };
}

function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('deciding suggestions', () => {
  it('keeps an accepted card, waiting, until its text is in the editor', async () => {
    const call = deferred();
    const act_ = vi.fn(() => call.promise);
    const review = (proposals: ProposalView[]): NoteReview => ({ proposals, comments: [], resolveComment: () => Promise.resolve(), act: act_ });
    const { result, rerender } = renderHook(({ decide, text }) => useNoteSuggestions(decide, text), { initialProps: { decide: review([proposal()]), text: NOTE } });
    const [first] = result.current.placement.hunks;
    let sent: Promise<boolean> = Promise.resolve(false);
    act(() => { sent = result.current.decisions.decide([first], 'accept'); });
    // A second decision while one is out sends nothing.
    await act(async () => { expect(await result.current.decisions.decide([first], 'reject')).toBe(false); });
    expect(act_).toHaveBeenCalledTimes(1);
    expect(result.current.decisions.busy).toBe(true);
    expect(result.current.decisions.deciding?.keys.has(first.key)).toBe(true);

    // The stream says it is accepted before the write reaches the editor:
    // the card stays, landing.
    rerender({ decide: review([proposal(['accepted', null])]), text: NOTE });
    await act(async () => { call.resolve(); await sent; });
    expect(result.current.placement.hunks.map((hunk) => hunk.key)).toEqual([first.key, result.current.placement.hunks[1].key]);
    expect(result.current.decisions.landing.has(first.key)).toBe(true);
    expect(result.current.decisions.busy).toBe(false);
    // The text comes: the card goes.
    rerender({ decide: review([proposal(['accepted', null])]), text: NOTE.replace('First paragraph.', 'One.') });
    expect(result.current.placement.hunks.map((hunk) => hunk.key)).not.toContain(first.key);
  });

  it('lets a landing card go after a while, should the text never come', async () => {
    vi.useFakeTimers();
    const review = (proposals: ProposalView[]): NoteReview => ({ proposals, comments: [], resolveComment: () => Promise.resolve(), act: () => Promise.resolve() });
    const { result, rerender } = renderHook(({ decide }) => useNoteSuggestions(decide, NOTE), { initialProps: { decide: review([proposal()]) } });
    const [first] = result.current.placement.hunks;
    await act(async () => { await result.current.decisions.decide([first], 'accept'); });
    rerender({ decide: review([proposal(['accepted', null])]) });
    expect(result.current.decisions.landing.has(first.key)).toBe(true);
    act(() => { vi.advanceTimersByTime(LANDING_MS); });
    expect(result.current.decisions.landing.size).toBe(0);
    expect(result.current.placement.hunks).toHaveLength(1);
  });

  it('frees the cards and says why in a toast when a decision fails', async () => {
    const review: NoteReview = { proposals: [proposal()], comments: [], resolveComment: () => Promise.resolve(), act: () => Promise.reject(new Error('guide.mdx changed while accepting: try again')) };
    render(<ToastStack />);
    const { result } = renderHook(() => useNoteSuggestions(review, NOTE));
    await act(async () => { expect(await result.current.decisions.decide(result.current.placement.hunks, 'accept')).toBe(false); });
    expect(screen.getByRole('alert').textContent).toContain('changed while accepting');
    expect(result.current.decisions.busy).toBe(false);
    expect(result.current.decisions.landing.size).toBe(0);
  });

  it('decides a landing card no more: Accept all and Source leave it out', async () => {
    const act_ = vi.fn(() => Promise.resolve());
    const review = (proposals: ProposalView[]): NoteReview => ({ proposals, comments: [], resolveComment: () => Promise.resolve(), act: act_ });
    const { result, rerender } = renderHook(({ decide }) => useNoteSuggestions(decide, NOTE), { initialProps: { decide: review([proposal()]) } });
    const [first, second] = result.current.placement.hunks;
    await act(async () => { await result.current.decisions.decide([first], 'accept'); });
    rerender({ decide: review([proposal(['accepted', null])]) });
    expect(result.current.decisions.landing.has(first.key)).toBe(true);
    expect(result.current.open.map((hunk) => hunk.key)).toEqual([second.key]);
    // A list that still has it (a stale render) sends only the other one.
    await act(async () => { await result.current.decisions.decide([first, second], 'reject'); });
    expect(act_).toHaveBeenLastCalledWith('p1', 'reject', ['2']);
  });

  it('holds every proposal accepted in one go until its text comes, not only the last one', async () => {
    const second = deferred();
    const act_ = vi.fn((id: string) => (id === 'p2' ? second.promise : Promise.resolve()));
    const one = { ...proposal([null, 'rejected']), id: 'p1' };
    const two = { ...proposal(['rejected', null]), id: 'p2' };
    const review = (proposals: ProposalView[]): NoteReview => ({ proposals, comments: [], resolveComment: () => Promise.resolve(), act: act_ });
    const { result, rerender } = renderHook(({ decide }) => useNoteSuggestions(decide, NOTE), { initialProps: { decide: review([one, two]) } });
    const [a, b] = result.current.placement.hunks;
    let sent: Promise<boolean> = Promise.resolve(false);
    act(() => { sent = result.current.decisions.decide([a, b], 'accept'); });
    await waitFor(() => { expect(act_).toHaveBeenCalledWith('p2', 'accept', ['2']); });
    // p1 went and the stream says so; p2 is still out.
    rerender({ decide: review([{ ...one, hunks: one.hunks.map((hunk) => ({ ...hunk, decided: 'accepted' as const })) }, two]) });
    expect(result.current.placement.hunks.map((hunk) => hunk.key)).toEqual([a.key, b.key]);
    expect(result.current.decisions.landing.has(a.key)).toBe(true);
    await act(async () => { second.reject(new Error('refused')); await sent; });
    // p2 failed: its card is open again; p1's still lands.
    expect(result.current.decisions.landing.has(a.key)).toBe(true);
    expect(result.current.decisions.landing.has(b.key)).toBe(false);
  });

  it('accepts all once however often it is clicked, and says what it is doing', () => {
    vi.useFakeTimers();
    const call = deferred();
    const review: NoteReview = { proposals: [proposal()], comments: [], resolveComment: () => Promise.resolve(), act: vi.fn(() => call.promise) };
    function Bar() {
      const suggestions = useNoteSuggestions(review, NOTE);
      return <SuggestionBar placement={suggestions.placement} focus={suggestions.focus} onStep={() => undefined} decisions={suggestions.decisions} />;
    }
    render(<Bar />);
    const bar = within(screen.getByRole('region', { name: 'Suggestions' }));
    const accept = bar.getByRole<HTMLButtonElement>('button', { name: /Accept all/ });
    fireEvent.click(accept);
    fireEvent.click(accept);
    fireEvent.click(bar.getByRole('button', { name: 'Reject all' }));
    expect(review.act).toHaveBeenCalledTimes(1);
    expect(review.act).toHaveBeenCalledWith('p1', 'accept', ['1', '2']);
    act(() => { vi.advanceTimersByTime(200); });
    expect(bar.getByRole('status').textContent).toContain('Accepting 2 suggestions…');
    expect(bar.getByRole<HTMLButtonElement>('button', { name: 'Reject all' }).disabled).toBe(true);
  });
});
