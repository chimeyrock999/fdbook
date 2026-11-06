// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TurnChange } from '#api/agents.ts';
import { fakeClient, Harness, summary } from '#tests/support/agents-ui.tsx';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('notes-studio:agent-panel', 'true');
});
afterEach(cleanup);

const end = (writes: string[]) => ({ type: 'end' as const, at: 2, conversation: summary({ status: 'done' }), turn: { status: 'done' as const, error: null, cost: null, usage: null, writes } });

describe('what a turn changed', () => {
  it('shows a proposal with a way to the note, and keeps or reverts what each turn changed itself', async () => {
    const done = summary({ status: 'done', turns: 2, writes: ['content/docs/meta.yaml', 'content/docs/late.mdx', 'package.json', 'content/docs/saved.mdx'] });
    const changes: TurnChange[] = [
      { path: 'content/docs/meta.yaml', existed: true, decided: null, reason: null },
      { path: 'content/docs/late.mdx', existed: true, decided: null, reason: null },
      // The server keeps no earlier version outside the notes (existed: false).
      { path: 'package.json', existed: false, decided: null, reason: 'outside the notes and their assets: revert it by hand' },
      { path: 'content/docs/saved.mdx', existed: true, decided: null, reason: 'also saved by a person during the turn: revert it by hand' },
    ];
    const { client, emit } = fakeClient([done], changes);
    client.read.mockResolvedValue({
      conversation: done,
      seq: 7,
      events: [
        { type: 'start', at: 0, conversation: done },
        { type: 'turn', at: 0, prompt: 'Tighten the intro', by: null },
        { type: 'proposal', at: 1, id: 'p1', path: 'content/docs/guide.mdx', hunks: 2 },
        end([]),
        { type: 'turn', at: 3, prompt: 'Fix the meta too', by: null },
        { type: 'write', at: 4, path: 'content/docs/meta.yaml', bytes: 10 },
        end(done.writes),
      ],
    });
    const onOpenNote = vi.fn();
    const user = userEvent.setup();
    render(<Harness client={client} onOpenNote={onOpenNote} />);
    await user.click(await screen.findByRole('button', { name: 'History' }));
    await user.click(await screen.findByRole('button', { name: /^Tighten the intro/ }));
    await user.click(await screen.findByRole('button', { name: 'Review in editor' }));
    expect(onOpenNote).toHaveBeenCalledWith('content/docs/guide.mdx');
    expect(screen.getByText('2 suggestions')).toBeTruthy();

    // Only the turn that changed files lists them, and asks for that turn's.
    const sections = await screen.findAllByRole('region', { name: 'Files this turn changed' });
    expect(sections).toHaveLength(1);
    expect(client.changes).toHaveBeenCalledWith('c1', 2);
    const section = within(sections[0]);
    expect(await section.findAllByText(/revert it by hand/)).toHaveLength(2);
    // A file a person saved too keeps its diff, only not Keep/Revert; one
    // outside the notes has no earlier version to show.
    const saved = within(section.getByText('content/docs/saved.mdx').closest('li') as HTMLElement);
    expect(saved.queryByRole('button', { name: 'Revert' })).toBeNull();
    await user.click(saved.getByRole('button', { name: 'View diff' }));
    expect(client.compare).toHaveBeenCalledWith('c1', 2, 'content/docs/saved.mdx');
    expect(within(section.getByText('package.json').closest('li') as HTMLElement).queryByRole('button', { name: 'View diff' })).toBeNull();
    const meta = within(section.getByText('content/docs/meta.yaml').closest('li') as HTMLElement);
    await user.click(meta.getByRole('button', { name: 'Revert' }));
    expect(client.decide).toHaveBeenCalledWith('c1', 2, 'content/docs/meta.yaml', 'revert');
    expect(await meta.findByText('Reverted')).toBeTruthy();
    const late = within(section.getByText('content/docs/late.mdx').closest('li') as HTMLElement);
    await user.click(late.getByRole('button', { name: 'Revert' }));
    // The failure is a toast; the row stays, to try again or keep.
    expect((await screen.findByRole('alert')).textContent).toMatch(/changed since the turn ended/);
    expect(late.queryByRole('alert')).toBeNull();
    await user.click(late.getByRole('button', { name: 'Keep' }));
    expect(await late.findByText('Kept')).toBeTruthy();

    // A decision on another page reads the turn's list again.
    expect(client.changes).toHaveBeenCalledTimes(1);
    emit({ type: 'decided', at: 9, conversationId: 'c1', turn: 2, path: 'content/docs/saved.mdx', decided: 'kept' });
    await waitFor(() => { expect(client.changes).toHaveBeenCalledTimes(2); });
  });
});
