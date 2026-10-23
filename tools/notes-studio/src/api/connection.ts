// The page's connection to the Studio server (#150): one watch for every
// event stream and the notes sync. A stream that fails 3 times in a row
// without staying open, or is not open again 10 s after it dropped, or that
// the server refuses, ends the page's connection: every stream and the sync
// are closed for good and the page asks for a reload (ServerDisconnected).
// Signing out is not a disconnect: studioFetch tells the page, as before.

import { confirmSignedIn, onSessionBack, studioFetch } from './session';

// Why the page stopped: the server cannot be reached, the change request it
// edits is closing or gone (409, 404), or the server refused the stream for
// another reason (`detail`: its answer).
export type Disconnect = { reason: 'unreachable' } | { reason: 'cr-closed' } | { reason: 'refused'; detail: string };

const FAILURES = 3;
// How long a dropped stream has to open again, and how long an open one
// has to stay open before its failures are forgotten.
export const WINDOW_MS = 10_000;
// After a failure the stream opens again at the pace the server asks for
// (`retry: 1000`). One refused for a session that ended waits for the
// sign-in (onSessionBack), and meanwhile tries again from 5 s, doubling up
// to a minute, in case the session came back without the page seeing it.
const REOPEN_MS = 1000;
const SIGNED_OUT_REOPEN_MS = 5000;
const SIGNED_OUT_MAX_MS = 60_000;
// How long the probe of a refused stream waits for an answer.
const PROBE_MS = 5000;

let current: Disconnect | null = null;
let leaving = false;
let leaveTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
// What to close on a disconnect: open streams and the sync.
const connections = new Set<() => void>();

export const disconnected = () => current;

export function onDisconnect(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function disconnect(next: Disconnect) {
  if (current !== null || leaving) return;
  current = next;
  for (const close of [...connections]) close();
  connections.clear();
  for (const listener of [...listeners]) listener();
}

// The page goes to another page (a change request, the list after a
// discard): its streams drop on the way, which is not a disconnect. A page
// still here after the window did not go (a leave warning was answered
// Stay), and one back from the back-forward cache is here again: the
// watch judges its streams as before.
export function leavePage() {
  leaving = true;
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => { leaving = false; }, WINDOW_MS);
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', leavePage);
  window.addEventListener('pageshow', () => {
    clearTimeout(leaveTimer);
    leaving = false;
  });
}

// Back to a fresh page, for tests.
export function resetConnection() {
  for (const close of [...connections]) close();
  connections.clear();
  listeners.clear();
  current = null;
  clearTimeout(leaveTimer);
  leaving = false;
}

// What a refused stream ran into. `failed`: the server had trouble of its
// own (5xx: gh down while it read the role), which may pass, so it counts as
// a failure; `detail` is what it said.
type Refusal = 'session' | Disconnect | { reason: 'failed'; detail: string } | null;

// EventSource does not say why it was refused, so the same URL is asked
// again with studioFetch, which tells the page about a session that ended
// (401). Null when it answers now; a server that does not answer within
// PROBE_MS is unreachable.
export async function refusalOf(url: string): Promise<Refusal> {
  const controller = new AbortController();
  const timeout = setTimeout(() => { controller.abort(); }, PROBE_MS);
  let response: Response;
  let detail = '';
  try {
    response = await studioFetch(url, { signal: controller.signal, headers: { Accept: 'text/event-stream' } });
    if (!response.ok) detail = await response.text().catch(() => '');
  } catch {
    return { reason: 'unreachable' };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
  if (response.ok) return null;
  if (response.status === 401) return 'session';
  // A role below reader: the page shows why (NoAccessPage).
  if (response.status === 403) {
    void confirmSignedIn();
    return 'session';
  }
  if (response.status === 404 || response.status === 409) return { reason: 'cr-closed' };
  let message = detail.trim();
  try {
    message = (JSON.parse(detail) as { error?: string }).error ?? message;
  } catch { /* plain text */ }
  message ||= `${String(response.status)} ${response.statusText}`.trim();
  return response.status >= 500 ? { reason: 'failed', detail: message } : { reason: 'refused', detail: message };
}

// Opens `url` as server-sent events and keeps it open, under the watch:
// `setup` attaches the listeners to each EventSource, `onOpen` runs on
// every connect. Returns the close. Once the page is disconnected nothing
// opens.
export function watchEvents(url: string, setup: (events: EventSource) => void, onOpen: () => void = () => undefined): () => void {
  if (current !== null) return () => undefined;
  let events: EventSource | null = null;
  let failures = 0;
  let reopen: ReturnType<typeof setTimeout> | undefined;
  let steady: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let signedOutWait = SIGNED_OUT_REOPEN_MS;
  let stopWaiting: (() => void) | null = null;
  // Why the last failure happened, for the notice: the server's own answer
  // when it gave one (5xx), else unreachable.
  let why: Disconnect = { reason: 'unreachable' };

  const later = (ms: number) => { reopen = setTimeout(open, ms); };
  const waitForSession = () => {
    reopen = setTimeout(() => {
      stopWaiting?.();
      stopWaiting = null;
      open();
    }, signedOutWait);
    signedOutWait = Math.min(signedOutWait * 2, SIGNED_OUT_MAX_MS);
    stopWaiting ??= onSessionBack(() => {
      stopWaiting?.();
      stopWaiting = null;
      clearTimeout(reopen);
      open();
    });
  };
  // While the page is leaving, nothing is a disconnect: the stream keeps
  // trying, in case the page stays after all.
  const armDeadline = () => {
    deadline ??= setTimeout(() => {
      deadline = undefined;
      disconnect(why);
    }, WINDOW_MS);
  };
  const failed = () => {
    failures += 1;
    armDeadline();
    if (failures >= FAILURES && !leaving) disconnect(why);
    else later(REOPEN_MS);
  };
  function open() {
    const source = new EventSource(url);
    events = source;
    setup(source);
    source.onopen = () => {
      clearTimeout(deadline);
      deadline = undefined;
      signedOutWait = SIGNED_OUT_REOPEN_MS;
      steady = setTimeout(() => { failures = 0; }, WINDOW_MS);
      onOpen();
    };
    source.onerror = () => {
      const refused = source.readyState === EventSource.CLOSED;
      source.close();
      clearTimeout(steady);
      if (stopped) return;
      why = { reason: 'unreachable' };
      if (!refused) {
        failed();
        return;
      }
      // The probe may hang on a server that stalls: the window still runs.
      armDeadline();
      void refusalOf(url).then((refusal) => {
        if (stopped) return;
        if (refusal === null) failed();
        else if (refusal === 'session') {
          // The sign-in comes up over the page; the stream waits for it.
          clearTimeout(deadline);
          deadline = undefined;
          failures = 0;
          waitForSession();
        } else if (refusal.reason === 'failed') {
          why = { reason: 'refused', detail: refusal.detail };
          failed();
        } else {
          // Also what the deadline says, should the page stay after a leave.
          why = refusal;
          disconnect(refusal);
        }
      });
    };
  }

  const close = () => {
    stopped = true;
    stopWaiting?.();
    clearTimeout(reopen);
    clearTimeout(steady);
    clearTimeout(deadline);
    events?.close();
    connections.delete(close);
  };
  connections.add(close);
  open();
  return close;
}

type SyncLike = { status(): string; onStatus(listener: (status: string) => void): () => void; close(): void };

// The notes sync reconnects on its own, without end: offline for the
// window, with the server not answering either, is a disconnect, and the
// sync is closed with the streams. A server that answers (the sync is
// refused for the change request; the streams tell why) is asked again
// after another window.
export function watchSync(client: SyncLike) {
  if (current !== null) {
    client.close();
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = (status: string) => {
    clearTimeout(timer);
    if (status !== 'offline') return;
    timer = setTimeout(() => {
      void fetch('/api/session').then((response) => response.ok, () => false).then((answers) => {
        if (client.status() !== 'offline') return;
        if (answers || leaving) check('offline');
        else disconnect({ reason: 'unreachable' });
      });
    }, WINDOW_MS);
  };
  const stopListening = client.onStatus(check);
  check(client.status());
  connections.add(() => {
    clearTimeout(timer);
    stopListening();
    client.close();
  });
}
