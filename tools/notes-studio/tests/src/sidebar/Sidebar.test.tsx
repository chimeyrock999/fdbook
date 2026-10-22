// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar, type IssueCount } from '../../../src/sidebar/Sidebar';
import { useSidebar } from '../../../src/sidebar/useSidebar';

function Harness({ drawer = false, issues = null, hasNote = false, onCloseDrawer = () => undefined, changeCount = 0, changeRequests = null }: {
  drawer?: boolean;
  issues?: IssueCount;
  hasNote?: boolean;
  onCloseDrawer?: () => void;
  changeCount?: number;
  changeRequests?: { shown: boolean; onOpen: () => void } | null;
}) {
  const state = useSidebar();
  return (
    <Sidebar state={state} drawer={drawer} onCloseDrawer={onCloseDrawer} issues={issues} hasNote={hasNote} notes={<p>tree</p>} assets={<p>asset list</p>}
      issuesRef={() => undefined} changes={<p>change list</p>} changeCount={changeCount} changeRequests={changeRequests} />
  );
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
  // jsdom has no pointer capture.
  HTMLElement.prototype.setPointerCapture = () => undefined;
});
afterEach(cleanup);

describe('Sidebar', () => {
  it('has an Assets view between Notes and Issues, kept across reloads', async () => {
    const { unmount } = render(<Harness />);
    const labels = [...screen.getByRole('navigation', { name: 'Sidebar views' }).querySelectorAll('button')].map((button) => button.getAttribute('aria-label'));
    expect(labels.slice(0, 3)).toEqual(['Notes', 'Assets', 'Issues']);
    await userEvent.click(screen.getByRole('button', { name: 'Assets' }));
    expect(screen.getByText('asset list').closest('.studio-pane-view')?.hasAttribute('hidden')).toBe(false);
    expect(screen.getByText('tree').closest('.studio-pane-view')?.hasAttribute('hidden')).toBe(true);
    expect(stored()).toMatchObject({ view: 'assets', shown: true });
    unmount();
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Assets' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('has a Changes view after Issues, with the number of changed files', async () => {
    const { rerender } = render(<Harness changeCount={0} />);
    const labels = [...screen.getByRole('navigation', { name: 'Sidebar views' }).querySelectorAll('button')].map((button) => button.getAttribute('aria-label'));
    expect(labels.slice(0, 4)).toEqual(['Notes', 'Assets', 'Issues', 'Changes']);
    expect(screen.getByRole('button', { name: 'Changes' }).querySelector('.studio-activity-count')).toBeNull();
    rerender(<Harness changeCount={5} />);
    const button = screen.getByRole('button', { name: 'Changes (5)' });
    expect(button.querySelector('.studio-activity-count')?.textContent).toBe('5');
    await userEvent.click(button);
    expect(screen.getByText('change list').closest('.studio-pane-view')?.hasAttribute('hidden')).toBe(false);
    expect(stored()).toMatchObject({ view: 'changes', shown: true });
  });

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

  it('shows and resizes within what the window leaves the editor', () => {
    const innerWidth = window.innerWidth;
    try {
      // 900px leaves 900 - 44 - 420 = 436px for the sidebar.
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });
      localStorage.setItem('notes-studio:sidebar', JSON.stringify({ view: 'notes', shown: true, width: 480 }));
      render(<Harness />);
      expect(pane().style.width).toBe('436px');
      expect(separator().getAttribute('aria-valuenow')).toBe('436');
      expect(separator().getAttribute('aria-valuemax')).toBe('436');
      // The first key press moves what is shown.
      fireEvent.keyDown(separator(), { key: 'ArrowLeft' });
      expect(pane().style.width).toBe('420px');
      fireEvent.keyDown(separator(), { key: 'End' });
      expect(stored()).toMatchObject({ width: 436 });
      // A press with no move keeps the stored preference.
      localStorage.setItem('notes-studio:sidebar', JSON.stringify({ view: 'notes', shown: true, width: 480 }));
      cleanup();
      render(<Harness />);
      fireEvent.pointerDown(separator(), { button: 0, pointerId: 1 });
      fireEvent.pointerUp(separator(), { pointerId: 1 });
      expect(stored()).toMatchObject({ width: 480 });
      // A drag past the edge stops there.
      fireEvent.pointerDown(separator(), { button: 0, pointerId: 1 });
      fireEvent.pointerMove(separator(), { clientX: 700, pointerId: 1 });
      fireEvent.pointerUp(separator(), { pointerId: 1 });
      expect(stored()).toMatchObject({ width: 436 });
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
    }
  });

  it("leaves a phone drawer's width to the stylesheet", () => {
    localStorage.setItem('notes-studio:sidebar', JSON.stringify({ view: 'notes', shown: true, width: 220 }));
    render(<Harness drawer />);
    expect(pane().style.width).toBe('');
  });

  it('drags the edge with the main button only, and saves the width once at the end', () => {
    render(<Harness />);
    fireEvent.pointerDown(separator(), { button: 2, pointerId: 1 });
    fireEvent.pointerMove(separator(), { clientX: 400, pointerId: 1 });
    expect(pane().style.width).toBe('284px');
    fireEvent.pointerDown(separator(), { button: 0, pointerId: 1 });
    fireEvent.pointerMove(separator(), { clientX: 360, pointerId: 1 });
    fireEvent.pointerMove(separator(), { clientX: 400, pointerId: 1 });
    expect(pane().style.width).toBe('400px');
    expect(separator().getAttribute('aria-valuenow')).toBe('400');
    expect(stored()).toBeNull();
    fireEvent.pointerUp(separator(), { pointerId: 1 });
    expect(stored()).toEqual({ view: 'notes', shown: true, width: 400 });
  });

  it('asks for a note only when none is open', async () => {
    const { rerender } = render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Issues' }));
    expect(screen.getByText('Open a note to see its issues.')).toBeTruthy();
    // A note is open but its first lint result has not come back.
    rerender(<Harness hasNote />);
    expect(screen.queryByText('Open a note to see its issues.')).toBeNull();
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

  it('opens the change requests from a button at the foot, above the hide button, only when there are change requests', async () => {
    const { rerender } = render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Change requests' })).toBeNull();
    const onOpen = vi.fn();
    rerender(<Harness changeRequests={{ shown: false, onOpen }} />);
    const labels = [...screen.getByRole('navigation', { name: 'Sidebar views' }).querySelectorAll('button')].map((button) => button.getAttribute('aria-label'));
    expect(labels).toEqual(['Notes', 'Assets', 'Issues', 'Changes', 'Change requests', 'Hide the sidebar']);
    await userEvent.click(screen.getByRole('button', { name: 'Change requests' }));
    expect(onOpen).toHaveBeenCalledOnce();
    rerender(<Harness changeRequests={{ shown: true, onOpen }} />);
    expect(screen.getByRole('button', { name: 'Change requests' }).getAttribute('aria-current')).toBe('page');
  });

  it('marks the open list as a page, apart from the open view', async () => {
    render(<Harness changeRequests={{ shown: true, onOpen: () => undefined }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Assets' }));
    const crs = screen.getByRole('button', { name: 'Change requests' });
    // The rail marks the open sidebar view only: the list is a page in the main pane.
    expect(crs.hasAttribute('aria-pressed')).toBe(false);
    expect(crs.getAttribute('aria-current')).toBe('page');
    expect(crs.classList.contains('studio-activity-page')).toBe(true);
    // It sits at the foot through .studio-activity-page + .studio-activity-bottom.
    expect(crs.nextElementSibling).toBe(screen.getByRole('button', { name: 'Hide the sidebar' }));
    const pressed = screen.getAllByRole('button', { pressed: true }).map((button) => button.getAttribute('aria-label'));
    expect(pressed).toEqual(['Assets']);
  });

  it('leaves the change requests button unmarked while the list is not open', () => {
    render(<Harness changeRequests={{ shown: false, onOpen: () => undefined }} />);
    const crs = screen.getByRole('button', { name: 'Change requests' });
    expect(crs.hasAttribute('aria-current')).toBe(false);
    expect(crs.hasAttribute('aria-pressed')).toBe(false);
  });
});
