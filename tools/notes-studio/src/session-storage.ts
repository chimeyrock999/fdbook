// What the page keeps in this tab's sessionStorage for the next page it
// loads (a change request switch, a sign-in, a reload). Storage can be off
// or full: then nothing is kept and nothing is read, and the page goes on.
export function keepInTab(key: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing kept.
  }
}

// The value kept under `key`, unchecked; null when there is none.
export function keptInTab(key: string): unknown {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
