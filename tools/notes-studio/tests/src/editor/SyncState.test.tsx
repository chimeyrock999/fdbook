// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictDialog, SaveStatus } from '../../../src/editor/SyncState';

afterEach(cleanup);

describe('ConflictDialog', () => {
  it('offers both versions and focuses keeping mine', async () => {
    const onKeepMine = vi.fn();
    const onTakeDisk = vi.fn();
    render(<ConflictDialog onKeepMine={onKeepMine} onTakeDisk={onTakeDisk} />);
    expect(screen.getByRole('alertdialog', { name: 'This note changed on disk' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep my version' }));
    await userEvent.click(screen.getByRole('button', { name: 'Take the disk version' }));
    expect(onTakeDisk).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Keep my version' }));
    expect(onKeepMine).toHaveBeenCalledOnce();
  });
});

describe('SaveStatus', () => {
  it('names each sync state', () => {
    const { rerender } = render(<SaveStatus status="saving" />);
    expect(screen.getByRole('status').textContent).toBe('Saving…');
    rerender(<SaveStatus status="denied" />);
    expect(screen.getByRole('status').textContent).toMatch(/Read-only/);
  });
});
