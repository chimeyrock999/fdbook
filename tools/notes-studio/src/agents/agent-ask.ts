import { useSyncExternalStore } from 'react';

// Asks the agent panel to run one of its actions (actions.ts) from
// elsewhere on the page, e.g. the note header's Fill. The panel takes
// asks while it is open in a change request for someone who may run
// agents and an author agent can run; otherwise nothing offers them.
// `pending`: the action asked for that is still on its way, for its
// button (#146's pattern: one at a time, pending while it goes).
type Asker = (actionId: string) => void;
export type AskState = { can: boolean; pending: string | null };

let asker: Asker | null = null;
let state: AskState = { can: false, pending: null };
const listeners = new Set<() => void>();
const set = (next: Partial<AskState>) => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};

// Answers how to stop taking asks.
export function takeAsks(next: Asker) {
  asker = next;
  set({ can: true });
  return () => {
    if (asker !== next) return;
    asker = null;
    set({ can: false, pending: null });
  };
}

// The action being asked for, as the panel runs it (null once it went).
export const askPending = (pending: string | null) => { if (state.pending !== pending) set({ pending }); };

export const askAgent = (actionId: string) => { asker?.(actionId); };

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useAsk() {
  return useSyncExternalStore(subscribe, () => state);
}
