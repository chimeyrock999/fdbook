import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createSessionClient, onSignedOut, setCsrf, type SessionState } from '../api/session';
import { NoAccessPage, SignInPage } from './SignInPage';
import { SessionContext } from './session';

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

// Reads who is signed in before the Studio loads. With sign-in on and
// nobody in, the sign-in page stands in for the Studio; someone without
// access sees why. A request that answers 401 later (the session expired)
// brings the sign-in page back.
export function SessionGate({ children }: { children: ReactNode }) {
  const client = useMemo(() => createSessionClient(), []);
  const [state, setState] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(SIGNIN_ERROR);

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

  const signOut = useCallback(() => {
    client.logout().then(apply, (reason: unknown) => { setError((reason as Error).message); });
  }, [client, apply]);
  const value = useMemo(() => (state === null ? null : { state, signOut }), [state, signOut]);

  if (value === null) {
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
  if (value.state.auth === 'github' && value.state.user === null) {
    return <SignInPage state={value.state} client={client} error={error} onSignedIn={apply} />;
  }
  if (value.state.role === 'none') return <NoAccessPage state={value.state} onSignOut={signOut} />;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
