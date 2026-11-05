// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { blocksOf } from '../../../server/proposals/hunks';
import { anchorAt } from '../../../server/review/anchors';
import type { AgentInfo, Conversation } from '../../../src/api/agents';
import type { Anchor, Thread, ThreadAuthor, ThreadSeverity } from '../../../src/api/proposals';
import type { Agents } from '../../../src/agents/useAgents';
import { pluginsExtension } from '../../../src/editor/extensions';
import { commentBubbleItem, setCommentDraft } from '../../../src/review/comment-draft';
import { ReviewPanel } from '../../../src/review/ReviewPanel';
import { REVIEW_PROMPT, type ThreadFocus } from '../../../src/review/texts';
import { Sidebar } from '../../../src/sidebar/Sidebar';
import { useSidebar } from '../../../src/sidebar/useSidebar';
import { VisualSuggestions, type NoteReview } from '../../../src/suggestions/Suggestions';
import { useNoteSuggestions } from '../../../src/suggestions/useNoteSuggestions';
import { createSuggestionLayer, type SuggestionLayer } from '../../../src/suggestions/visual';
import { mountVisual, stubLayout, textAt } from '../../support/visual-editor';

const PATH = 'content/notes/guide.mdx';
const NOTE = '---\ntitle: Guide\n---\n\n# Guide\n\nFirst paragraph.\n\nSecond paragraph.\n';
const CLAUDE: ThreadAuthor = { kind: 'run', runId: 'r1', agent: 'claude', model: 'opus', role: 'reviewer' };
const PERSON: ThreadAuthor = { kind: 'person', login: 'thoai' };

let made = 0;
function thread(extra: Partial<Thread> & { by?: ThreadAuthor; body?: string } = {}): Thread {
  made += 1;
  const { by = CLAUDE, body = `Finding ${String(made)}.`, ...rest } = extra;
  return {
    id: `t${String(made)}`, path: PATH, anchor: anchorAt(blocksOf(NOTE), 2), orphaned: false, severity: 'nit', rule: null, state: 'open', suggestion: null,
    comments: [{ id: `c${String(made)}`, body, by, createdMs: made }], createdMs: made, updatedMs: made, ...rest,
  };
}

afterEach(() => {
  cleanup();
  setCommentDraft(null);
});

function agentsWith(conversations: Conversation[] = [], start = vi.fn(() => Promise.resolve({ id: 'chat-1' } as Conversation))) {
  const agents: AgentInfo[] = [
    { id: 'claude', name: 'Claude Code', fencesReviewer: true, available: true, reason: null, note: null, version: null },
    { id: 'codex', name: 'Codex', fencesReviewer: true, available: true, reason: null, note: null, version: null },
  ];
  return { agents, picks: { author: 'claude', reviewer: null }, pick: vi.fn(), start, conversations, setPanel: vi.fn() } as unknown as Agents & { start: typeof start; pick: ReturnType<typeof vi.fn>; setPanel: ReturnType<typeof vi.fn> };
}

describe('ReviewPanel', () => {
  const threads = () => [
    thread({ severity: 'blocking', body: 'Wrong fact.' }),
    thread({ severity: 'nit', state: 'addressed', body: 'Shorter.' }),
    thread({ severity: null, by: PERSON, path: 'content/notes/other.mdx', body: 'A person asks.' }),
    thread({ severity: 'blocking', state: 'needs-decision', body: 'Kept by the reviewer.' }),
    thread({ state: 'resolved', body: 'Done long ago.' }),
  ];
  const bodies = () => screen.queryAllByRole('button').map((button) => button.querySelector('.studio-review-item-body')?.textContent).filter(Boolean);

  it('lists the threads not resolved by note, and filters them by state, severity, author and note', async () => {
    render(<ReviewPanel threads={threads()} activeNote={null} readOnly agents={null} onPick={vi.fn()} onOpenThread={vi.fn()} />);
    expect(bodies()).toEqual(['Wrong fact.', 'Shorter.', 'Kept by the reviewer.', 'A person asks.']);
    expect(document.querySelector('.studio-review-summary')?.textContent).toBe('2 blocking1 needs your decision4 shown');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Severity' }), 'blocking');
    expect(bodies()).toEqual(['Wrong fact.', 'Kept by the reviewer.']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'State' }), 'needs-decision');
    expect(bodies()).toEqual(['Kept by the reviewer.']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Severity' }), 'all');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'State' }), 'all');
    expect(bodies()).toContain('Done long ago.');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Author' }), 'thoai');
    expect(bodies()).toEqual(['A person asks.']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Author' }), 'Anyone');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Note' }), 'other.mdx');
    expect(bodies()).toEqual(['A person asks.']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Severity' }), 'nit');
    expect(screen.getByText('No thread matches these filters.')).toBeTruthy();
  });

  it('hands a picked thread over, and lets a writer comment on the open note', async () => {
    const onPick = vi.fn();
    const onOpenThread = vi.fn(() => Promise.resolve());
    const [first] = threads();
    render(<ReviewPanel threads={[first]} activeNote={PATH} readOnly={false} agents={null} onPick={onPick} onOpenThread={onOpenThread} />);
    await userEvent.click(screen.getByRole('button', { name: /Wrong fact/ }));
    expect(onPick).toHaveBeenCalledWith(first);
    await userEvent.click(screen.getByRole('button', { name: 'Comment on the note' }));
    const box = within(screen.getByRole('dialog', { name: 'Comment on guide.mdx' }));
    await userEvent.type(box.getByRole('textbox', { name: 'Comment' }), 'The note needs a summary.');
    await userEvent.selectOptions(box.getByRole('combobox', { name: 'Severity' }), 'blocking');
    await userEvent.click(box.getByRole('button', { name: 'Comment' }));
    expect(onOpenThread).toHaveBeenCalledWith(PATH, 'The note needs a summary.', 'blocking');
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
  });

  it('starts one reviewer chat on Review this CR, and follows it', async () => {
    const agents = agentsWith();
    const { rerender } = render(<ReviewPanel threads={[]} activeNote={null} readOnly={false} agents={agents} onPick={vi.fn()} onOpenThread={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Reviewer agent' })).toHaveProperty('value', 'codex');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Reviewer agent' }), 'claude');
    expect(agents.pick).toHaveBeenCalledWith('reviewer', 'claude');
    const run = screen.getByRole('button', { name: 'Review this CR' });
    await act(async () => { run.click(); run.click(); await Promise.resolve(); });
    expect(agents.start).toHaveBeenCalledTimes(1);
    expect(agents.start).toHaveBeenCalledWith('reviewer', REVIEW_PROMPT);
    expect(REVIEW_PROMPT).toMatch(/cr_changes.*style guide.*add_comment/);
    const chat = { id: 'chat-1', agentName: 'Codex', status: 'running' } as Conversation;
    rerender(<ReviewPanel threads={[]} activeNote={null} readOnly={false} agents={{ ...agents, conversations: [chat] }} onPick={vi.fn()} onOpenThread={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('Codex is reviewing');
    await userEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    expect(agents.setPanel).toHaveBeenCalledWith(true);
    rerender(<ReviewPanel threads={[]} activeNote={null} readOnly={false} agents={{ ...agents, conversations: [{ ...chat, status: 'ended' } as unknown as Conversation] }} onPick={vi.fn()} onOpenThread={vi.fn()} />);
    expect(screen.getByText('Codex finished: its threads are below.')).toBeTruthy();
  });
});

describe('the Review view', () => {
  beforeEach(() => { localStorage.clear(); });

  function Harness({ review }: { review: { view: React.ReactNode; blocking: number } | null }) {
    const state = useSidebar();
    return <Sidebar state={state} drawer={false} onCloseDrawer={() => undefined} issues={null} hasNote={false} notes={<p>tree</p>} assets={null} issuesRef={() => undefined} review={review} />;
  }

  it('is in a change request only, its badge the blocking threads that wait', async () => {
    const { rerender } = render(<Harness review={null} />);
    expect(screen.queryByRole('button', { name: /Review/ })).toBeNull();
    rerender(<Harness review={{ view: <p>threads</p>, blocking: 2 }} />);
    const button = screen.getByRole('button', { name: 'Review (2 blocking)' });
    expect(button.querySelector('.studio-activity-count')?.textContent).toBe('2');
    await userEvent.click(button);
    expect(screen.getByText('threads').closest('.studio-pane-view')?.hasAttribute('hidden')).toBe(false);
    // Kept as the view, but a page without it (main) shows the notes.
    rerender(<Harness review={null} />);
    expect(screen.getByText('tree').closest('.studio-pane-view')?.hasAttribute('hidden')).toBe(false);
  });
});

// The real Visual editor with the suggestion layer, as NoteEditor mounts it.
type Open = (anchor: Anchor | null, body: string, severity: ThreadSeverity | null) => Promise<void>;
function Layer({ layer, threads, open, focus, text = NOTE }: { layer: SuggestionLayer; threads: Thread[]; open: Open; focus: ThreadFocus | null; text?: string }) {
  const none = () => Promise.resolve();
  const review: NoteReview = { proposals: [], threads, act: none, openThread: open, replyThread: none, moveThread: none };
  const { placement, focus: hunk, decisions } = useNoteSuggestions(review, text);
  return <VisualSuggestions layer={layer} placement={placement} focus={hunk} readOnly={false} decisions={decisions} text={text} threads={{ open, reply: none, move: none }} threadFocus={focus} />;
}

describe('threads in Visual', () => {
  beforeAll(stubLayout);

  it('opens a thread on the selection\'s block from the format bubble\'s Comment', async () => {
    const open = vi.fn<Open>(() => Promise.resolve());
    const layer = createSuggestionLayer();
    const { editor } = await mountVisual(NOTE, { extensions: [pluginsExtension('studioNote', [layer.plugin])], bubbleItems: [commentBubbleItem], extra: () => <Layer layer={layer} threads={[]} open={open} focus={null} /> });
    expect(commentBubbleItem.isEnabled?.(editor)).toBe(false);
    const at = textAt(editor, 'Second');
    act(() => { editor.commands.setTextSelection({ from: at, to: at + 6 }); });
    expect(commentBubbleItem.isEnabled?.(editor)).toBe(true);
    act(() => { commentBubbleItem.run(editor); });
    const box = within(await screen.findByRole('dialog', { name: 'Comment on this block' }));
    await userEvent.type(box.getByRole('textbox', { name: 'Comment' }), 'Say which.');
    await userEvent.click(box.getByRole('button', { name: 'Comment' }));
    expect(open).toHaveBeenCalledWith(anchorAt(blocksOf(NOTE), 3), 'Say which.', null);
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
  });

  it('keeps the comment on its block when a block comes in above it before it is sent', async () => {
    const open = vi.fn<Open>(() => Promise.resolve());
    const layer = createSuggestionLayer();
    let setText: (text: string) => void = () => undefined;
    function Live() {
      const [text, set] = useState(NOTE);
      setText = set;
      return <Layer layer={layer} threads={[]} open={open} focus={null} text={text} />;
    }
    await mountVisual(NOTE, { extensions: [pluginsExtension('studioNote', [layer.plugin])], extra: () => <Live /> });
    act(() => { setCommentDraft(3); });
    const box = within(await screen.findByRole('dialog', { name: 'Comment on this block' }));
    await userEvent.type(box.getByRole('textbox', { name: 'Comment' }), 'Still this one.');
    const moved = NOTE.replace('First paragraph.', 'First paragraph.\n\nA new one.');
    act(() => { setText(moved); });
    await userEvent.click(box.getByRole('button', { name: 'Comment' }));
    expect(open).toHaveBeenCalledWith(anchorAt(blocksOf(moved), 4), 'Still this one.', null);
  });

  it('marks a block red only while a blocking thread there waits, as the Review view counts', async () => {
    const layer = createSuggestionLayer();
    let setThreads: (threads: Thread[]) => void = () => undefined;
    function Live() {
      const [threads, set] = useState([thread({ severity: 'blocking', state: 'rejected' })]);
      setThreads = set;
      return <Layer layer={layer} threads={threads} open={() => Promise.resolve()} focus={null} />;
    }
    await mountVisual(NOTE, { extensions: [pluginsExtension('studioNote', [layer.plugin])], extra: () => <Live /> });
    expect((await screen.findByRole('button', { name: /1 thread/ })).dataset.tone).toBeUndefined();
    act(() => { setThreads([thread({ severity: 'blocking', state: 'needs-decision' })]); });
    await waitFor(() => { expect(screen.getByRole('button', { name: /1 thread/ }).dataset.tone).toBe('blocking'); });
  });

  it('opens the thread the Review panel picked, each time it is picked', async () => {
    const picked = thread({ body: 'Look here.' });
    const layer = createSuggestionLayer();
    function Picker() {
      const [focus, setFocus] = useState<ThreadFocus | null>(null);
      return (
        <>
          <button type="button" onClick={() => { setFocus((previous) => ({ id: picked.id, seq: (previous?.seq ?? 0) + 1 })); }}>pick</button>
          <Layer layer={layer} threads={[picked]} open={() => Promise.resolve()} focus={focus} />
        </>
      );
    }
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    await mountVisual(NOTE, { extensions: [pluginsExtension('studioNote', [layer.plugin])], extra: () => <Picker /> });
    await waitFor(() => { expect(screen.getByRole('button', { name: '1 thread, from Claude Code' })).toBeTruthy(); });
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'pick' }));
    expect(within(await screen.findByRole('dialog', { name: 'Review thread' })).getByText('Look here.')).toBeTruthy();
    expect(scrolled).toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await userEvent.click(screen.getByRole('button', { name: 'pick' }));
    expect(await screen.findByRole('dialog', { name: 'Review thread' })).toBeTruthy();
  });
});
