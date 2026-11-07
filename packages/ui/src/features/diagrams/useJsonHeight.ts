import { useState } from 'react';

// The JSON view's height under the drawing, as the person left it: kept in
// localStorage (only a convenience, so a missing or blocked store is fine).
const STORAGE_KEY = 'studio-diagram-json-height';
// Neither half shrinks below this.
export const SPLIT_MIN = 120;

function stored(): number | null {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value >= SPLIT_MIN ? value : null;
  } catch {
    return null;
  }
}

function store(height: number | null) {
  try {
    if (height === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(Math.round(height)));
  } catch {
    // kept for this page only
  }
}

// The JSON's height (null: half the column) and the handle that sets it.
export function useJsonHeight() {
  const [height, setHeight] = useState(stored);
  const set = (next: number | null) => {
    setHeight(next);
    store(next);
  };
  return { height, set };
}
