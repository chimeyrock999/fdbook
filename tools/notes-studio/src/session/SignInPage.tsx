import { Check, Copy, ExternalLink, KeyRound, LogIn } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DeviceStart, SessionClient, SessionState } from '../api/session';

type Step = { kind: 'choose' } | { kind: 'device'; code: DeviceStart } | { kind: 'starting' };

function DeviceCode({ code, client, onDone, onCancel, onError }: {
  code: DeviceStart;
  client: SessionClient;
  onDone: (state: SessionState) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const callbacks = useRef({ onDone, onError });
  useEffect(() => { callbacks.current = { onDone, onError }; });
  // Asks the server every `interval` seconds, longer once GitHub says slow down.
  useEffect(() => {
    let interval = code.interval;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const poll = () => {
      client.pollDevice(code.flow).then(
        (answer) => {
          if (stopped) return;
          if (answer.state === 'done') callbacks.current.onDone(answer.session);
          else {
            setTrouble(answer.error ?? null);
            interval = answer.interval ?? interval;
            timer = setTimeout(poll, interval * 1000);
          }
        },
        (error: unknown) => { if (!stopped) callbacks.current.onError((error as Error).message); },
      );
    };
    timer = setTimeout(poll, interval * 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [client, code]);
  const copy = () => {
    navigator.clipboard.writeText(code.userCode).then(() => { setCopied(true); }, () => { setCopied(false); });
  };
  return (
    <>
      <h1>Enter the code on GitHub</h1>
      <p>Open {code.verificationUri.replace(/^https:\/\//, '')} and enter this code. It expires in {Math.round(code.expiresIn / 60)} minutes.</p>
      <output className="studio-signin-code" aria-label="Sign-in code">{code.userCode}</output>
      <div className="studio-signin-row">
        <button type="button" className="studio-button gap-1.5" onClick={copy}>
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? 'Copied' : 'Copy code'}
        </button>
        <a className="studio-button studio-button-primary gap-1.5" href={code.verificationUri} target="_blank" rel="noreferrer">
          <ExternalLink size={14} aria-hidden /> Open GitHub
        </a>
      </div>
      <p className="studio-signin-wait" role="status"><span aria-hidden /> Waiting for GitHub…</p>
      {trouble !== null && <p className="studio-signin-error" role="alert">{trouble} Trying again…</p>}
      <button type="button" className="studio-button self-start" onClick={onCancel}>Cancel</button>
    </>
  );
}

// Instead of the Studio while nobody is signed in: a button for each sign-in
// the server offers, in its order (STUDIO_GITHUB_FLOWS), the first one the
// main one. `error` is why the last sign-in failed (a web sign-in comes back
// with it in ?signin_error=).
export function SignInPage({ state, client, error: initialError, onSignedIn }: {
  state: SessionState;
  client: SessionClient;
  error: string | null;
  onSignedIn: (state: SessionState) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [error, setError] = useState(initialError);
  const repo = state.repo ?? 'this repository';
  const startDevice = () => {
    setError(null);
    setStep({ kind: 'starting' });
    client.startDevice().then((code) => { setStep({ kind: 'device', code }); }, (reason: unknown) => {
      setError((reason as Error).message);
      setStep({ kind: 'choose' });
    });
  };
  const failed = (message: string) => {
    setError(message);
    setStep({ kind: 'choose' });
  };
  return (
    <main className="studio-signin">
      <div className="studio-signin-card">
        {step.kind === 'device' ? (
          <DeviceCode code={step.code} client={client} onDone={onSignedIn} onCancel={() => { setStep({ kind: 'choose' }); }} onError={failed} />
        ) : (
          <>
            <h1>Sign in to Notes Studio</h1>
            <p>
              This Studio needs a GitHub account with access to <b>{repo}</b>.{' '}
              {state.flows[0] === 'web' ? 'You go to github.com and come back here.' : 'It gives you a code to enter on github.com.'}
            </p>
            {error !== null && <p className="studio-signin-error" role="alert">{error}</p>}
            {state.flows.map((flow, index) => (
              <div key={flow} className="contents">
                {index > 0 && <div className="studio-signin-or">or</div>}
                {flow === 'web' ? (
                  <a className={`studio-button studio-signin-button gap-2 ${index === 0 ? 'studio-button-primary' : ''}`} href={client.webUrl}>
                    <LogIn size={16} aria-hidden /> Continue with GitHub
                  </a>
                ) : (
                  <button type="button" className={`studio-button studio-signin-button gap-2 ${index === 0 ? 'studio-button-primary' : ''}`} disabled={step.kind === 'starting'} onClick={startDevice}>
                    <KeyRound size={16} aria-hidden /> Sign in with a code
                  </button>
                )}
              </div>
            ))}
            <p className="studio-signin-foot">The Studio reads only your name and picture. What you may do comes from your access to the repository; no token is kept.</p>
          </>
        )}
      </div>
    </main>
  );
}

// After sign-in, for someone the repository does not let in.
export function NoAccessPage({ state, onSignOut }: { state: SessionState; onSignOut: () => void }) {
  return (
    <main className="studio-signin">
      <div className="studio-signin-card">
        <h1>No access</h1>
        <p className="studio-signin-error" role="alert">@{state.user?.login} is signed in but has no access to {state.repo ?? 'this repository'}.</p>
        <p>Ask the owner to add you as a collaborator (or to STUDIO_ALLOWED_USERS), then sign in again.</p>
        <button type="button" className="studio-button self-start" onClick={onSignOut}>Sign in with another account</button>
      </div>
    </main>
  );
}
