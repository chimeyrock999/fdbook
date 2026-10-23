import { useCallback, useRef, useState } from 'react';

// A write that must not run twice at once (#138): `run(work)` starts `work`
// unless one is still going, and `busy` holds while it goes, for the
// control to show and disable. A call while busy answers undefined at once.
export function useBusy() {
  const [busy, setBusy] = useState(false);
  // Set at once, so a second click in the same tick finds it.
  const going = useRef(false);
  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    if (going.current) return undefined;
    going.current = true;
    setBusy(true);
    try {
      return await work();
    } finally {
      going.current = false;
      setBusy(false);
    }
  }, []);
  return [busy, run] as const;
}
