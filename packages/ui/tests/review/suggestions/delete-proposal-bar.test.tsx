// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeleteProposalView } from '#api/proposals.ts';
import { DeleteProposalBar } from '#review/suggestions/DeleteProposalBar.tsx';

afterEach(cleanup);

const proposal = (path: string): DeleteProposalView => ({
  id: 'd1', path, by: { kind: 'run', runId: 'r1', agent: 'claude', model: null }, summary: 'Superseded by the overview.', createdMs: 1, decided: null, state: 'open',
});

describe('DeleteProposalBar', () => {
  it('says who proposes deleting the page and why, and reviews or rejects it', async () => {
    const onReview = vi.fn();
    const onReject = vi.fn(() => Promise.resolve());
    render(<DeleteProposalBar deletion={{ proposal: proposal('guide/old.mdx'), waiting: false, onReview, onReject }} readOnly={false} />);
    const bar = screen.getByRole('region', { name: 'Proposed delete' });
    expect(bar.textContent).toContain('Claude Code proposes deleting this page');
    expect(bar.textContent).toContain('Superseded by the overview.');
    await userEvent.click(screen.getByRole('button', { name: 'Review delete…' }));
    expect(onReview).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => { expect(onReject).toHaveBeenCalled(); });
  });

  it('names a folder, and has no actions for a reader', () => {
    render(<DeleteProposalBar deletion={{ proposal: proposal('guide'), waiting: false, onReview: vi.fn(), onReject: vi.fn() }} readOnly />);
    expect(screen.getByRole('region').textContent).toContain('proposes deleting the folder guide');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('waits for the note to be saved before the delete is reviewed', () => {
    const onReview = vi.fn();
    render(<DeleteProposalBar deletion={{ proposal: proposal('guide/old.mdx'), waiting: true, onReview, onReject: vi.fn() }} readOnly={false} />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Review delete…' }).disabled).toBe(true);
    expect(screen.getByRole('region').textContent).toContain('once it shows Saved');
  });
});
