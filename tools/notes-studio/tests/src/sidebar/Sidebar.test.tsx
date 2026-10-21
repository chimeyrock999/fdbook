// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar, type IssueCount } from '../../../src/sidebar/Sidebar';
import { useSidebar } from '../../../src/sidebar/useSidebar';

function Harness({ drawer = false, issues = null, onCloseDrawer = () => undefined }: { drawer?: boolean; issues?: IssueCount; onCloseDrawer?: () => void }) {
  const state = useSidebar();
  return <Sidebar state={state} drawer={drawer} onCloseDrawer={onCloseDrawer} issues={issues} notes={<p>tree</p>} issuesRef={() => undefined} />;
}

const stored = () => JSON.parse(localStorage.getItem('notes-studio:sidebar') ?? 'null') as unknown;
function pane() {
  const element = screen.getByText('tree').closest<HTMLElement>('.studio-pane');
  if (!element) throw new Error('no pane');
  return element;
}
const separator = () => screen.getByRole('separator', { name: 'Resize the sidebar' });

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe('Sidebar', () => {
  it('switches views from the activity bar and folds on the open one, as VS Code does', async () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Notes' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('tree').closest('.studio-pane-view')?.hasAttribute('hidden')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Issues' }));
    expect(screen.getByText('tree').closest('.studio-pane-view')?.hasAttribute('hidden')).toBe(true);
    expect(screen.getByText('Open a note to see its issues.')).toBeTruthy();
    // The open view's own button folds the sidebar; picking it again brings it back.
    await userEvent.click(screen.getByRole('button', { name: 'Issues' }));
    expect(pane().hidden).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Issues' }));
    expect(pane().hidden).toBe(false);
    expect(stored()).toEqual({ view: 'issues', shown: true, width: 284 });
  });

  it('hides and shows from the button at the foot of the activity bar, and remembers it', async () => {
    const { unmount } = render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Hide the sidebar' }));
    expect(pane().hidden).toBe(true);
    unmount();
    render(<Harness />);
    expect(pane().hidden).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Show the sidebar' }));
    expect(pane().hidden).toBe(false);
  });

  it('always shows its view as a drawer, and its buttons leave the desktop layout alone', async () => {
    localStorage.setItem('notes-studio:sidebar', JSON.stringify({ view: 'notes', shown: false, width: 300 }));
    const onCloseDrawer = vi.fn();
    render(<Harness drawer onCloseDrawer={onCloseDrawer} />);
    expect(pane().hidden).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Issues' }));
    await userEvent.click(screen.getByRole('button', { name: 'Issues' }));
    expect(pane().hidden).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Hide the sidebar' }));
    expect(onCloseDrawer).toHaveBeenCalled();
    // The desktop sidebar stays hidden; only the view changed.
    expect(stored()).toEqual({ view: 'issues', shown: false, width: 300 });
  });

  it('resizes with the keyboard and resets on double-click, within 220–480px', () => {
    render(<Harness />);
    fireEvent.keyDown(separator(), { key: 'ArrowRight' });
    expect(pane().style.width).toBe('300px');
    fireEvent.keyDown(separator(), { key: 'ArrowLeft', shiftKey: true });
    expect(pane().style.width).toBe('252px');
    fireEvent.keyDown(separator(), { key: 'End' });
    expect(separator().getAttribute('aria-valuenow')).toBe('480');
    fireEvent.keyDown(separator(), { key: 'ArrowRight' });
    expect(pane().style.width).toBe('480px');
    fireEvent.keyDown(separator(), { key: 'Home' });
    expect(pane().style.width).toBe('220px');
    fireEvent.doubleClick(separator());
    expect(pane().style.width).toBe('284px');
  });

  it('reads a broken or out-of-range stored layout safely', () => {
    localStorage.setItem('notes-studio:sidebar', JSON.stringify({ view: 'nope', shown: 'yes', width: 9000 }));
    render(<Harness />);
    expect(pane().style.width).toBe('480px');
    expect(screen.getByRole('button', { name: 'Notes' }).getAttribute('aria-pressed')).toBe('true');
    cleanup();
    localStorage.setItem('notes-studio:sidebar', '{not json');
    render(<Harness />);
    expect(pane().style.width).toBe('284px');
  });

  it('shows the open note’s issue count on the Issues button', () => {
    const { rerender } = render(<Harness issues={{ count: 3, errors: true }} />);
    const button = screen.getByRole('button', { name: 'Issues (3)' });
    expect(button.querySelector('.studio-activity-count')?.textContent).toBe('3');
    expect(button.querySelector('[data-errors]')).toBeTruthy();
    rerender(<Harness issues={{ count: 0, errors: false }} />);
    expect(screen.getByRole('button', { name: 'Issues' }).querySelector('.studio-activity-count')).toBeNull();
  });
});
