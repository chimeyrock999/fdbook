// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrimaryActionButton } from '#changes/PrimaryActionButton.tsx';

afterEach(cleanup);

// On a phone the header shows the action's icon only (#162): its label is
// hidden there, and stays its name for assistive tech.
describe('PrimaryActionButton', () => {
  it('is named by its label, which a phone hides, and says what it does in its title', async () => {
    const onAction = vi.fn();
    render(<PrimaryActionButton action={{ kind: 'commit', label: 'Commit', title: 'Pick the files and write a message in Changes', disabled: false }} onAction={onAction} />);
    const button = screen.getByRole('button', { name: 'Commit' });
    expect(button.getAttribute('title')).toBe('Pick the files and write a message in Changes');
    expect(screen.getByText('Commit').className).toContain('max-md:hidden');
    await userEvent.click(button);
    expect(onAction).toHaveBeenCalledWith('commit');
  });

  it('names View PR, a link, the same way', () => {
    render(<PrimaryActionButton action={{ kind: 'view', label: 'View PR', title: 'Pull request #7 on GitHub', disabled: false, href: 'https://github.com/o/r/pull/7' }} onAction={vi.fn()} />);
    const link = screen.getByRole('link', { name: 'View PR' });
    expect(link.getAttribute('href')).toBe('https://github.com/o/r/pull/7');
    expect(screen.getByText('View PR').className).toContain('max-md:hidden');
  });
});
