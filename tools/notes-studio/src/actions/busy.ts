import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from './toasts';

// The busy state of a component's write actions (#138), the one way a
// Studio button that writes to the server waits for its request:
//
//   const action = useBusy();
//   <PendingButton pending={action.is('keep')} disabled={action.busy} onClick={() => { void action.run(() => client.keep(path), 'keep'); }}>
//
// `run` starts the task unless one is running (a second click, Enter
// pressed twice, Escape during an answer), so a request goes once. The
// ref holds that before React renders the disabled button. A task that
// throws shows its error in a toast; `run` resolves whether the task
// finished, so a dialog stays open on a failure and can be tried again.
// `key` names the action running, for the button that shows the spinner.
export function useBusy() {
  const [running, setRunning] = useState<string | null>(null);
  const holds = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async (task: () => Promise<unknown>, key = 'action'): Promise<boolean> => {
    if (holds.current) return false;
    holds.current = true;
    setRunning(key);
    try {
      await task();
      return true;
    } catch (reason) {
      toast.error(reason);
      return false;
    } finally {
      holds.current = false;
      if (mounted.current) setRunning(null);
    }
  }, []);

  return { busy: running !== null, running, is: (key = 'action') => running === key, run };
}

export type Busy = ReturnType<typeof useBusy>;

// How long a request goes before its button shows the spinner: a quick one
// only disables it, without a flash.
export const SPINNER_AFTER_MS = 150;

// Whether `on` has held for `ms`.
export function useShownAfter(on: boolean, ms = SPINNER_AFTER_MS) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) return undefined;
    const timer = setTimeout(() => { setShown(true); }, ms);
    return () => {
      clearTimeout(timer);
      setShown(false);
    };
  }, [on, ms]);
  return on && shown;
}
