// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SPINNER_AFTER_MS, useBusy } from '../../../src/actions/busy';
import { PendingButton } from '../../../src/actions/PendingButton';
import { ToastStack } from '../../../src/actions/ToastStack';
import { TOAST_MS, toast } from '../../../src/actions/toasts';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// A promise the test settles.
function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function Save({ task, onDone = () => undefined }: { task: () => Promise<void>; onDone?: (ok: boolean) => void }) {
  const action = useBusy();
  return (
    <>
      <PendingButton pending={action.is('save')} pendingLabel="Saving…" disabled={action.busy} onClick={() => { void action.run(task, 'save').then(onDone); }}>Save</PendingButton>
      <PendingButton pending={action.is('drop')} disabled={action.busy} onClick={() => { void action.run(task, 'drop').then(onDone); }}>Drop</PendingButton>
      <ToastStack />
    </>
  );
}

describe('useBusy', () => {
  it('runs one task at a time: a click while one is going sends nothing', async () => {
    const call = deferred();
    const task = vi.fn(() => call.promise);
    const onDone = vi.fn();
    render(<Save task={task} onDone={onDone} />);
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
    // Twice before React renders the disabled button.
    await act(async () => { save.click(); save.click(); await Promise.resolve(); });
    expect(task).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(false);
    expect(save.disabled).toBe(true);
    expect(save.getAttribute('aria-busy')).toBe('true');
    // The other action waits too, without a spinner of its own.
    const drop = screen.getByRole<HTMLButtonElement>('button', { name: 'Drop' });
    expect(drop.disabled).toBe(true);
    expect(drop.getAttribute('aria-busy')).toBeNull();
    await act(async () => { call.resolve(); await call.promise; });
    expect(onDone).toHaveBeenLastCalledWith(true);
    expect(save.disabled).toBe(false);
  });

  it('is free again when the task fails, and says why in a toast', async () => {
    const call = deferred();
    const onDone = vi.fn();
    render(<Save task={() => call.promise} onDone={onDone} />);
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
    fireEvent.click(save);
    await act(async () => { call.reject(new Error('note.mdx changed on disk')); await call.promise.catch(() => undefined); });
    expect(onDone).toHaveBeenCalledWith(false);
    expect(save.disabled).toBe(false);
    expect(screen.getByRole('alert').textContent).toContain('note.mdx changed on disk');
  });
});

describe('PendingButton', () => {
  it('shows the spinner and what it is doing only once the request takes a moment', () => {
    vi.useFakeTimers();
    const { rerender } = render(<PendingButton pending={false} pendingLabel="Sending…">Send</PendingButton>);
    rerender(<PendingButton pending pendingLabel="Sending…">Send</PendingButton>);
    const button = screen.getByRole<HTMLButtonElement>('button');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Send');
    act(() => { vi.advanceTimersByTime(SPINNER_AFTER_MS); });
    expect(button.textContent).toBe(' Sending…');
    expect(button.querySelector('.studio-spin')).not.toBeNull();
    rerender(<PendingButton pending={false} pendingLabel="Sending…">Send</PendingButton>);
    expect(button.textContent).toBe('Send');
    expect(button.disabled).toBe(false);
  });

  it('swaps an icon button\'s icon for the spinner', () => {
    vi.useFakeTimers();
    render(<PendingButton pending pendingLabel={null} aria-label="Accept suggestion"><svg data-testid="check" /></PendingButton>);
    act(() => { vi.advanceTimersByTime(SPINNER_AFTER_MS); });
    const button = screen.getByRole('button', { name: 'Accept suggestion' });
    expect(screen.queryByTestId('check')).toBeNull();
    expect(button.querySelector('.studio-spin')).not.toBeNull();
  });
});

describe('toasts', () => {
  it('shows a message once while it is on screen, goes after a while, and can be dismissed', () => {
    vi.useFakeTimers();
    render(<ToastStack />);
    act(() => { toast.error(new Error('Could not rename: a page with that name exists')); });
    act(() => { vi.advanceTimersByTime(TOAST_MS - 1000); });
    // The same message again keeps the one shown, for longer.
    act(() => { toast.error('Could not rename: a page with that name exists'); });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(TOAST_MS - 1000); });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByRole('alert')).toBeNull();

    act(() => { toast.error('one'); toast.warning('two'); });
    expect(screen.getByRole('status').textContent).toContain('two');
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[1]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
