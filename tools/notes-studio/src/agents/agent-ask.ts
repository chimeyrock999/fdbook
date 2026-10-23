import { useSyncExternalStore } from 'react';

// Asks the agent panel to run one of its actions (actions.ts) from
// elsewhere on the page, e.g. the note header's Fill. The panel takes
// asks while it is open in a change request for someone who may run
// agents; otherwise nothing offers them.
type Asker = (actionId: string) => void;

let asker: Asker | null = null;
const listeners = new Set<() => void>();
const changed = () => { for (const listener of listeners) listener(); };

// Answers how to stop taking asks.
export function takeAsks(next: Asker) {
  asker = next;
  changed();
  return () => {
    if (asker !== next) return;
    asker = null;
    changed();
  };
}

export const askAgent = (actionId: string) => { asker?.(actionId); };

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

// Whether the panel takes asks now.
export function useCanAsk() {
  return useSyncExternalStore(subscribe, () => asker !== null);
}
