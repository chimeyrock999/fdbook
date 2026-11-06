// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentsClient } from '#api/agents.ts';
import { disconnected, leavePage, onDisconnect, resetConnection, watchEvents, watchSync, WINDOW_MS } from '#api/connection.ts';
import { createFilesClient } from '#api/files.ts';
import { createProposalsClient } from '#api/proposals.ts';
import { onSignedOut, sessionBack } from '#api/session.ts';

// An EventSource the test opens, drops and refuses by hand. `drop` is a
// network error (the browser would reconnect: CONNECTING), `refuse` a
// non-200 answer (CLOSED).
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static opened: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.opened.push(this);
  }
  addEventListener() { /* named events are not sent here */ }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  drop() {
    this.readyState = FakeEventSource.CONNECTING;
    this.onerror?.();
  }
  refuse() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}

function last() {
  const events = FakeEventSource.opened.at(-1);
  if (events === undefined) throw new Error('no EventSource opened');
  return events;
}
const live = () => FakeEventSource.opened.filter((each) => !each.closed);

// The probe of a refused stream answers `status`, or fails like a server
// that is gone (null).
function answerProbe(status: number | null, body: unknown = {}) {
  const fetch = vi.fn(() => (status === null
    ? Promise.reject(new TypeError('Failed to fetch'))
    : Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

// A proxy before the Studio answers for it with a page of its own.
function answerProxy(status: number) {
  const fetch = vi.fn(() => Promise.resolve(new Response('<html><body>Bad Gateway</body></html>', { status, headers: { 'Content-Type': 'text/html' } })));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  resetConnection();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeEventSource.opened = [];
});

describe('the connection watch', () => {
  it('gives up after 3 failures in a row: one disconnect, every stream closed, nothing reopened', async () => {
    const notices = vi.fn();
    onDisconnect(notices);
    const files = createFilesClient();
    files.subscribeFileEvents(() => undefined);
    createProposalsClient().subscribe(() => undefined);
    createAgentsClient().subscribe(() => undefined);
    expect(live()).toHaveLength(3);
    const events = FakeEventSource.opened[0];

    events.drop();
    await vi.advanceTimersByTimeAsync(1000);
    last().drop();
    await vi.advanceTimersByTimeAsync(1000);
    last().drop();

    expect(disconnected()).toEqual({ reason: 'unreachable' });
    expect(notices).toHaveBeenCalledTimes(1);
    expect(live()).toHaveLength(0);
    const count = FakeEventSource.opened.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.opened).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
    // A stream asked for afterwards does not open either.
    files.subscribeFileEvents(() => undefined);
    createAgentsClient().subscribe(() => undefined);
    expect(FakeEventSource.opened).toHaveLength(count);
  });

  it('shows nothing for a drop that opens again within the window', async () => {
    const onOpen = vi.fn();
    watchEvents('/api/events', () => undefined, onOpen);
    last().open();
    last().drop();
    await vi.advanceTimersByTimeAsync(1000);
    last().open();
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 3);
    expect(disconnected()).toBeNull();
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(live()).toHaveLength(1);
  });

  it('forgets failures once a stream stayed open for the window', async () => {
    watchEvents('/api/events', () => undefined);
    for (let round = 0; round < 3; round += 1) {
      last().drop();
      await vi.advanceTimersByTimeAsync(1000);
      last().drop();
      await vi.advanceTimersByTimeAsync(1000);
      last().open();
      await vi.advanceTimersByTimeAsync(WINDOW_MS);
    }
    expect(disconnected()).toBeNull();
  });

  it('counts failures of a stream that opens but does not stay open', async () => {
    watchEvents('/api/events', () => undefined);
    for (let round = 0; round < 3; round += 1) {
      last().open();
      last().drop();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(disconnected()).toEqual({ reason: 'unreachable' });
  });

  it('disconnects when a dropped stream is not open again within the window', async () => {
    watchEvents('/api/events', () => undefined);
    last().open();
    last().drop();
    await vi.advanceTimersByTimeAsync(1000);
    // Still connecting: neither open nor failed again.
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    expect(disconnected()).toEqual({ reason: 'unreachable' });
    expect(live()).toHaveLength(0);
  });

  it('says the change request is closing when a stream is refused with 409', async () => {
    answerProbe(409, { error: 'this change request is closing' });
    createProposalsClient().subscribe(() => undefined);
    watchEvents('/api/events', () => undefined);
    (FakeEventSource.opened[0]).refuse();
    await vi.advanceTimersByTimeAsync(0);
    expect(disconnected()).toEqual({ reason: 'cr-closed' });
    expect(live()).toHaveLength(0);
  });

  it('says the change request is gone when a stream is refused with 404', async () => {
    answerProbe(404, { error: 'no such change request: x' });
    watchEvents('/api/events', () => undefined);
    last().refuse();
    await vi.advanceTimersByTimeAsync(0);
    expect(disconnected()).toEqual({ reason: 'cr-closed' });
  });

  it('passes on what the server said when it refuses for another reason', async () => {
    answerProbe(400, { error: 'bad stream' });
    watchEvents('/api/events', () => undefined);
    last().refuse();
    await vi.advanceTimersByTimeAsync(0);
    expect(disconnected()).toEqual({ reason: 'refused', detail: 'bad stream' });
  });

  it('counts a server error (5xx) as a failure that may pass, and says what the server said once it gave up', async () => {
    answerProbe(503, { error: 'GitHub cannot be reached to read your role' });
    watchEvents('/api/events', () => undefined);
    last().refuse();
    await vi.advanceTimersByTimeAsync(0);
    expect(disconnected()).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    last().refuse();
    await vi.advanceTimersByTimeAsync(1000);
    last().refuse();
    await vi.advanceTimersByTimeAsync(0);
    expect(disconnected()).toEqual({ reason: 'refused', detail: 'GitHub cannot be reached to read your role' });
  });

  it('opens again after a passing server error', async () => {
    answerProbe(503, { error: 'try later' });
    watchEvents('/api/events', () => undefined);
    last().refuse();
    await vi.advanceTimersByTimeAsync(1000);
    last().open();
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 2);
    expect(disconnected()).toBeNull();
  });

  it('disconnects when the probe of a refused stream hangs', async () => {
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')); });
    }));
    watchEvents('/api/events', () => undefined);
    last().refuse();
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    expect(disconnected()).toEqual({ reason: 'unreachable' });
  });

  it('says the server is unreachable when the probe of a refused stream fails', async () => {
    answerProbe(null);
    watchEvents('/api/events', () => undefined);
    last().refuse();
    await vi.advanceTimersByTimeAsync(0);
    expect(disconnected()).toEqual({ reason: 'unreachable' });
  });

  it('leaves a signed-out stream to the sign-in: no disconnect, it opens again after a pause', async () => {
    answerProbe(401, { error: 'Sign in to use the Studio.' });
    const signedOut = vi.fn();
    const stop = onSignedOut(signedOut);
    watchEvents('/api/events', () => undefined);
    last().refuse();
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 2);
    expect(disconnected()).toBeNull();
    expect(signedOut).toHaveBeenCalled();
    expect(live()).toHaveLength(1);
    stop();
  });

  it('keeps a signed-out page quiet: an hour on the sign-in sends a bounded number of requests', async () => {
    const probe = answerProbe(401, { error: 'Sign in to use the Studio.' });
    const signedOut = vi.fn();
    const stop = onSignedOut(signedOut);
    // Every stream the server sees is refused at once, for an hour.
    watchEvents('/api/events', () => undefined);
    const end = Date.now() + 3600_000;
    while (Date.now() < end) {
      const events = last();
      if (!events.closed) events.refuse();
      await vi.advanceTimersToNextTimerAsync();
    }
    // 5, 10, 20, 40 s, then a minute: about 64 tries an hour, not 720.
    expect(FakeEventSource.opened.length).toBeLessThan(70);
    expect(probe.mock.calls.length).toBeLessThan(70);
    expect(signedOut.mock.calls.length).toBeLessThan(70);
    expect(disconnected()).toBeNull();
    stop();
  });

  it('opens a signed-out stream again as soon as the session is back, and forgets the backoff', async () => {
    answerProbe(401, { error: 'Sign in to use the Studio.' });
    watchEvents('/api/events', () => undefined);
    last().refuse();
    await vi.advanceTimersByTimeAsync(5000);
    last().refuse();
    await vi.advanceTimersByTimeAsync(1000);
    // Waiting 10 s now.
    const count = FakeEventSource.opened.length;
    expect(count).toBe(2);
    sessionBack();
    expect(FakeEventSource.opened).toHaveLength(count + 1);
    last().open();
    expect(live()).toHaveLength(1);
    // The backoff timer that was waiting opens nothing more.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.opened).toHaveLength(count + 1);
  });

  it('counts a refused stream that answers on the probe as one failure', async () => {
    answerProbe(200);
    watchEvents('/api/events', () => undefined);
    last().refuse();
    await vi.advanceTimersByTimeAsync(1000);
    expect(disconnected()).toBeNull();
    expect(live()).toHaveLength(1);
  });

  it('shows nothing while the page goes to another page', async () => {
    answerProbe(null);
    watchEvents('/api/events', () => undefined);
    leavePage();
    for (let round = 0; round < 4; round += 1) {
      last().drop();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(disconnected()).toBeNull();
  });

  it('keeps why a stream was refused while leaving, for a page that stayed after all', async () => {
    answerProbe(409, { error: 'this change request is closing' });
    watchEvents('/api/events', () => undefined);
    leavePage();
    last().refuse();
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 3);
    expect(disconnected()).toEqual({ reason: 'cr-closed' });
  });

  it('judges the streams again when the page stayed after all', async () => {
    watchEvents('/api/events', () => undefined);
    leavePage();
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    // Still trying: the next failures count.
    for (let round = 0; round < 3; round += 1) {
      last().drop();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(disconnected()).toEqual({ reason: 'unreachable' });
  });

  it('judges the streams again for a page back from the back-forward cache', async () => {
    watchEvents('/api/events', () => undefined);
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    for (let round = 0; round < 3; round += 1) {
      last().drop();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(disconnected()).toEqual({ reason: 'unreachable' });
  });
});

// The sync's side, as @fumadocs-editor/core/sync reports it.
function fakeSync() {
  let status = 'connecting';
  const listeners = new Set<(status: string) => void>();
  return {
    close: vi.fn(),
    status: () => status,
    onStatus(listener: (status: string) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(next: string) {
      status = next;
      for (const listener of listeners) listener(next);
    },
  };
}

describe('the sync under the watch', () => {
  it('disconnects after the sync was offline for the window with the server gone, and closes it', async () => {
    const probe = answerProbe(null);
    const sync = fakeSync();
    watchSync(sync);
    watchEvents('/api/events', () => undefined);
    sync.set('offline');
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    expect(probe).toHaveBeenCalledWith('/api/session');
    expect(disconnected()).toEqual({ reason: 'unreachable' });
    expect(sync.close).toHaveBeenCalledTimes(1);
    expect(live()).toHaveLength(0);
  });

  it('shows nothing when the sync is back within the window', async () => {
    const probe = answerProbe(null);
    const sync = fakeSync();
    watchSync(sync);
    sync.set('offline');
    await vi.advanceTimersByTimeAsync(WINDOW_MS - 1000);
    sync.set('online');
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 2);
    expect(probe).not.toHaveBeenCalled();
    expect(disconnected()).toBeNull();
    expect(sync.close).not.toHaveBeenCalled();
  });

  it.each([502, 503])('counts a proxy that answers %i for a dead Studio as gone', async (status) => {
    answerProxy(status);
    const sync = fakeSync();
    watchSync(sync);
    sync.set('offline');
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    expect(disconnected()).toEqual({ reason: 'unreachable' });
  });

  it('counts a gateway that answers in JSON of its own for a dead Studio as gone', async () => {
    answerProbe(502, { message: 'Bad gateway' });
    const sync = fakeSync();
    watchSync(sync);
    sync.set('offline');
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    expect(disconnected()).toEqual({ reason: 'unreachable' });
  });

  it('keeps waiting while the Studio answers 503 (gh cannot read the role) and the sync stays offline', async () => {
    const probe = answerProbe(503, { error: 'Could not read your access to the repository: gh failed' });
    const sync = fakeSync();
    watchSync(sync);
    sync.set('offline');
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 3);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(disconnected()).toBeNull();
    expect(sync.close).not.toHaveBeenCalled();
  });

  it('keeps waiting while the server answers and the sync stays offline', async () => {
    answerProbe(200);
    const sync = fakeSync();
    watchSync(sync);
    sync.set('offline');
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 3);
    expect(disconnected()).toBeNull();
    expect(sync.close).not.toHaveBeenCalled();
  });

  it('closes the sync and the streams when a stream gives up', async () => {
    answerProbe(409);
    const sync = fakeSync();
    watchSync(sync);
    watchEvents('/api/events', () => undefined);
    last().refuse();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.close).toHaveBeenCalledTimes(1);
  });
});
