// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TurnChange } from '../../../src/api/agents';
import { fakeClient, Harness, summary } from '../../support/agents-ui';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('notes-studio:agent-panel', 'true');
});
afterEach(cleanup);

const end = (writes: string[]) => ({ type: 'end' as const, at: 2, conversation: summary({ status: 'done' }), turn: { status: 'done' as const, error: null, cost: null, usage: null, writes } });

describe('what a turn changed', () => {
  it('shows a proposal with a way to the note, and keeps or reverts what each turn changed itself', async () => {
    const done = summary({ status: 'done', turns: 2, writes: ['content/notes/meta.yaml', 'content/notes/late.mdx', 'package.json', 'content/notes/saved.mdx'] });
    const changes: TurnChange[] = [
      { path: 'content/notes/meta.yaml', existed: true, decided: null, reason: null },
      { path: 'content/notes/late.mdx', existed: true, decided: null, reason: null },
      // The server keeps no earlier version outside the notes (existed: false).
      { path: 'package.json', existed: false, decided: null, reason: 'outside the notes and their assets: revert it by hand' },
      { path: 'content/notes/saved.mdx', existed: true, decided: null, reason: 'also saved by a person during the turn: revert it by hand' },
    ];
    const { client, emit } = fakeClient([done], changes);
    client.read.mockResolvedValue({
      conversation: done,
      seq: 7,
      events: [
        { type: 'start', at: 0, conversation: done },
        { type: 'turn', at: 0, prompt: 'Tighten the intro', by: null },
        { type: 'proposal', at: 1, id: 'p1', path: 'content/notes/guide.mdx', hunks: 2 },
        end([]),
        { type: 'turn', at: 3, prompt: 'Fix the meta too', by: null },
        { type: 'write', at: 4, path: 'content/notes/meta.yaml', bytes: 10 },
        end(done.writes),
      ],
    });
    const onOpenNote = vi.fn();
    const user = userEvent.setup();
    render(<Harness client={client} onOpenNote={onOpenNote} />);
    await user.click(await screen.findByRole('button', { name: 'History' }));
    await user.click(await screen.findByRole('button', { name: /^Tighten the intro/ }));
    await user.click(await screen.findByRole('button', { name: 'Review in editor' }));
    expect(onOpenNote).toHaveBeenCalledWith('content/notes/guide.mdx');
    expect(screen.getByText('2 suggestions')).toBeTruthy();

    // Only the turn that changed files lists them, and asks for that turn's.
    const sections = await screen.findAllByRole('region', { name: 'Files this turn changed' });
    expect(sections).toHaveLength(1);
    expect(client.changes).toHaveBeenCalledWith('c1', 2);
    const section = within(sections[0]);
    expect(await section.findAllByText(/revert it by hand/)).toHaveLength(2);
    // A file a person saved too keeps its diff, only not Keep/Revert; one
    // outside the notes has no earlier version to show.
    const saved = within(section.getByText('content/notes/saved.mdx').closest('li') as HTMLElement);
    expect(saved.queryByRole('button', { name: 'Revert' })).toBeNull();
    await user.click(saved.getByRole('button', { name: 'View diff' }));
    expect(client.compare).toHaveBeenCalledWith('c1', 2, 'content/notes/saved.mdx');
    expect(within(section.getByText('package.json').closest('li') as HTMLElement).queryByRole('button', { name: 'View diff' })).toBeNull();
    const meta = within(section.getByText('content/notes/meta.yaml').closest('li') as HTMLElement);
    await user.click(meta.getByRole('button', { name: 'Revert' }));
    expect(client.decide).toHaveBeenCalledWith('c1', 2, 'content/notes/meta.yaml', 'revert');
    expect(await meta.findByText('Reverted')).toBeTruthy();
    const late = within(section.getByText('content/notes/late.mdx').closest('li') as HTMLElement);
    await user.click(late.getByRole('button', { name: 'Revert' }));
    expect((await late.findByRole('alert')).textContent).toMatch(/changed since the turn ended/);
    await user.click(late.getByRole('button', { name: 'Keep' }));
    expect(await late.findByText('Kept')).toBeTruthy();

    // A decision on another page reads the turn's list again.
    expect(client.changes).toHaveBeenCalledTimes(1);
    emit({ type: 'decided', at: 9, conversationId: 'c1', turn: 2, path: 'content/notes/saved.mdx', decided: 'kept' });
    await waitFor(() => { expect(client.changes).toHaveBeenCalledTimes(2); });
  });
});
