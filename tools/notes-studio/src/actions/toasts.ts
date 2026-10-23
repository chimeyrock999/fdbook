// The Studio's toasts (#138): what went wrong with an action (a button or a
// dialog that writes to the server), or with a read in the background. One
// stack for the page (ToastStack), fed from anywhere: a component, a hook
// or a client callback. A message already on screen is not shown twice; it
// stays up longer instead.

export const TOAST_MS = 8000;

export type ToastTone = 'error' | 'warning';
export type Toast = { id: number; tone: ToastTone; message: string };

let toasts: Toast[] = [];
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

const changed = () => { for (const listener of listeners) listener(); };

export const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

export function dismissToast(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  toasts = toasts.filter((each) => each.id !== id);
  changed();
}

function show(tone: ToastTone, message: string) {
  const shown = toasts.find((each) => each.message === message && each.tone === tone);
  const id = shown?.id ?? nextId++;
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => { dismissToast(id); }, TOAST_MS));
  if (shown === undefined) {
    toasts = [{ id, tone, message }, ...toasts];
    changed();
  }
}

export const toast = {
  error: (reason: unknown) => { show('error', messageOf(reason)); },
  warning: (message: string) => { show('warning', message); },
};

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const currentToasts = () => toasts;

// Every toast goes (tests, between cases).
export function clearToasts() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  toasts = [];
  changed();
}
