// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConnection, watchEvents } from '#api/connection.ts';
import { ServerDisconnected } from '#session/ServerDisconnected.tsx';

// Refuses every stream at once (CLOSED), so the probe decides why.
class RefusedEventSource {
  static readonly CLOSED = 2;
  readyState = 0;
  onerror: (() => void) | null = null;
  constructor() {
    queueMicrotask(() => {
      this.readyState = RefusedEventSource.CLOSED;
      this.onerror?.();
    });
  }
  close() { this.readyState = RefusedEventSource.CLOSED; }
}

function probeAnswers(status: number | null) {
  vi.stubGlobal('fetch', () => (status === null
    ? Promise.reject(new TypeError('Failed to fetch'))
    : Promise.resolve(new Response(JSON.stringify({ error: 'this change request is closing' }), { status }))));
}

beforeEach(() => {
  vi.stubGlobal('EventSource', RefusedEventSource);
});

afterEach(() => {
  cleanup();
  resetConnection();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <>
      <main><textarea aria-label="Note" /></main>
      <ServerDisconnected />
    </>,
  );
}

describe('ServerDisconnected', () => {
  it('shows nothing while connected', () => {
    renderPage();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('blocks the page with a reload when the server cannot be reached', async () => {
    probeAnswers(null);
    const { container } = renderPage();
    await act(async () => {
      watchEvents('/api/events', () => undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const dialog = screen.getByRole('alertdialog', { name: 'Server disconnected' });
    expect(dialog.textContent).toContain('The Studio server can’t be reached.');
    expect(dialog.textContent).toContain('Unsaved text in open notes is kept in this tab');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    // The page behind takes nothing: it is inert, and Esc does not close the notice.
    expect(container.contains(screen.getByLabelText('Note'))).toBe(true);
    expect(container.inert).toBe(true);
    expect(container.contains(dialog)).toBe(false);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /close|dismiss/i })).toBeNull();
    // What is portalled into the body afterwards is inert too.
    const later = document.createElement('div');
    await act(async () => {
      document.body.append(later);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(later.inert).toBe(true);
    later.remove();
  });

  it('says the change request is closing or closed for a 409', async () => {
    probeAnswers(409);
    renderPage();
    await act(async () => {
      watchEvents('/api/agents/events', () => undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByRole('alertdialog').textContent).toContain('This change request is closing or was closed');
  });

  it('reloads the page from the button', async () => {
    probeAnswers(null);
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    renderPage();
    await act(async () => {
      watchEvents('/api/events', () => undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
