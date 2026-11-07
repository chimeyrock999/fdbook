// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LintIssue } from '#api/lint.ts';
import { IssuesChip, IssuesPanel } from '#features/lint/IssuesPanel.tsx';

afterEach(cleanup);

const at = (line: number, offset: number) => ({ line, column: 1, offset });
const ISSUES: LintIssue[] = [
  { rule: 'link-broken', severity: 'error', message: 'Link `./x` does not reach a page.', start: at(3, 10), end: at(3, 20) },
  { rule: 'emphasis-marker', severity: 'warning', message: 'Emphasis uses `_`; use *text*, as the editor writes it.', start: at(9, 80), end: at(9, 90) },
];

describe('IssuesPanel', () => {
  it('lists issues with line and rule, and picks one', async () => {
    const onSelect = vi.fn();
    render(<IssuesPanel state={{ status: 'ready', issues: ISSUES }} onSelect={onSelect} />);
    expect(screen.getByText('1 error')).toBeTruthy();
    expect(screen.getByText('1 warning')).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Link ./x does not reach a page.Line 3link-broken',
      'Emphasis uses _; use *text*, as the editor writes it.Line 9emphasis-marker',
    ]);
    expect(buttons[0]?.querySelector('code')?.textContent).toBe('./x');
    await userEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith(ISSUES[1]);
  });

  it('says when the note is clean, still checking, or could not be checked', () => {
    const { rerender } = render(<IssuesPanel state={{ status: 'ready', issues: [] }} onSelect={vi.fn()} />);
    expect(screen.getByText('No issues')).toBeTruthy();
    rerender(<IssuesPanel state={{ status: 'checking', issues: null }} onSelect={vi.fn()} />);
    expect(screen.getByText('Checking…')).toBeTruthy();
    rerender(<IssuesPanel state={{ status: 'failed', issues: ISSUES, error: 'Error: offline' }} onSelect={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toBe('Could not check the note: Error: offline');
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});

describe('IssuesChip', () => {
  it('counts issues and opens the list', async () => {
    const onOpen = vi.fn();
    const { rerender } = render(<IssuesChip state={{ status: 'ready', issues: ISSUES }} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: '2 issues' }));
    expect(onOpen).toHaveBeenCalledOnce();
    rerender(<IssuesChip state={{ status: 'ready', issues: [ISSUES[0]] }} onOpen={onOpen} />);
    expect(screen.getByRole('button').textContent).toBe('1 issue');
    rerender(<IssuesChip state={{ status: 'ready', issues: [] }} onOpen={onOpen} />);
    expect(screen.getByRole('button').textContent).toBe('No issues');
    rerender(<IssuesChip state={{ status: 'checking', issues: null }} onOpen={onOpen} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
