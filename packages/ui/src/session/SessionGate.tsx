import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createSessionClient, onSeatCheck, onSignedOut, sessionBack, setCsrf, type SessionState } from '#api/session.ts';
import { NoAccessPage, SignInPage } from './SignInPage';
import { rightsOf, SessionContext, type SessionValue } from './session';

// Why a web sign-in failed, as the server sends the browser back; taken off
// the address so a reload does not show it again.
function takeSignInError() {
  const url = new URL(window.location.href);
  const error = url.searchParams.get('signin_error');
  if (error === null) return null;
  url.searchParams.delete('signin_error');
  window.history.replaceState(window.history.state, '', url);
  return error;
}

// Read once when the page loads (StrictMode runs state initializers twice).
const SIGNIN_ERROR = typeof window === 'undefined' ? null : takeSignInError();

// Whether `state` lets someone into the Studio.
const allows = (state: SessionState) => !(state.auth === 'github' && state.user === null) && state.role !== 'none';

// Whether the Studio can carry on for `next` as it ran for `before`: the
// same person, still allowed to write if they were.
function sameSeat(before: SessionState, next: SessionState) {
  return before.user?.login === next.user?.login && (rightsOf(next.role).write || !rightsOf(before.role).write);
}

// Reads who is signed in before the Studio loads. With sign-in on and
// nobody in, the sign-in page stands in for the Studio; someone without
// access sees why. When the session ends once the Studio is open (a request
// answers 401, the sync socket closes), the sign-in comes up over it
// instead: the Studio stays mounted behind, inert, with the session it had,
// so an editor keeps its unsaved edits and saves them once its socket
// reconnects with the new session (#121). Someone else signing in, or the
// same person no longer allowed to write, gets the Studio afresh: open
// notes keep their unsaved edits for that person (src/editor/unsaved.ts)
// and do not save them under another account. A sign-in in another tab
// shows when the sync reconnects: its seat check reads the session and
// refuses the connection unless it is the Studio's seat.
export function SessionGate({ children }: { children: ReactNode }) {
  const client = useMemo(() => createSessionClient(), []);
  const [state, setState] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(SIGNIN_ERROR);
  // The session the Studio last ran with, kept for it while the sign-in is
  // over it; null until the Studio first showed, and again after signing out.
  const [shown, setShown] = useState<SessionValue | null>(null);
  // Changes when the Studio must be mounted afresh.
  const [mount, setMount] = useState(0);
  const seat = useRef<SessionState | null>(null);
  useEffect(() => { seat.current = shown?.state ?? null; }, [shown]);

  const apply = useCallback((next: SessionState) => {
    setCsrf(next.csrf);
    setState(next);
  }, []);
  const load = useCallback(() => {
    client.load().then(apply, (reason: unknown) => { setError((reason as Error).message); });
  }, [client, apply]);

  useEffect(() => {
    load();
    return onSignedOut(load);
  }, [load]);

  // The session the browser holds now, as the sync sees it on a reconnect.
  useEffect(() => {
    onSeatCheck(async () => {
      const next = await client.load();
      const before = seat.current;
      apply(next);
      return before === null || (allows(next) && sameSeat(before, next));
    });
    return () => { onSeatCheck(null); };
  }, [client, apply]);

  // Signing out leaves the Studio: the sign-in page stands in for it.
  const signOut = useCallback(() => {
    client.logout().then((next) => {
      setShown(null);
      apply(next);
    }, (reason: unknown) => { setError((reason as Error).message); });
  }, [client, apply]);
  const value = useMemo(() => (state === null ? null : { state, signOut }), [state, signOut]);
  const allowed = value !== null && allows(value.state);
  // The event streams wait for the session to come back (src/api/connection.ts).
  const wasEnded = useRef(false);
  const ended = shown !== null && !allowed;
  useEffect(() => {
    if (wasEnded.current && !ended) sessionBack();
    wasEnded.current = ended;
  }, [ended]);
  if (allowed && shown !== value) {
    if (shown !== null && !sameSeat(shown.state, value.state)) setMount(mount + 1);
    setShown(value);
  }

  if (shown === null && value === null) {
    if (error === null) return null;
    return (
      <main className="studio-signin">
        <div className="studio-signin-card">
          <p className="studio-signin-error" role="alert">{error}</p>
          <button type="button" className="studio-button self-start" onClick={() => { setError(null); load(); }}>Try again</button>
        </div>
      </main>
    );
  }
  const gate = value === null || allowed ? null : value.state.user === null
    ? <SignInPage state={value.state} client={client} error={error} onSignedIn={apply} ended={ended} />
    : <NoAccessPage state={value.state} onSignOut={signOut} ended={ended} />;
  if (shown === null) return gate;
  // One shape from the first show on, so the Studio is never mounted again.
  return (
    <>
      <div key={mount} inert={ended} className="contents">
        <SessionContext.Provider value={shown}>{children}</SessionContext.Provider>
      </div>
      {gate}
    </>
  );
}
