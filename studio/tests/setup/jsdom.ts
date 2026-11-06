import { afterEach } from 'vitest';
import { clearToasts } from '../../src/actions/toasts';

// Runs before every test file (vitest.config.ts). jsdom has no matchMedia,
// and the editor asks it about touch input and reduced motion once its live
// editor mounts, a moment after the first paint: a test that renders it
// without this fails only when it runs slowly. Set on the window, not with
// vi.stubGlobal, so a file's vi.unstubAllGlobals() keeps it; a test that
// needs a query to match stubs its own over it.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  // An EventTarget, so listeners can be added and removed (the old
  // addListener too); nothing fires.
  window.matchMedia = (media: string) => {
    const target = new EventTarget();
    const legacy = {
      addListener: (listener: EventListener | null) => { target.addEventListener('change', listener); },
      removeListener: (listener: EventListener | null) => { target.removeEventListener('change', listener); },
    };
    return Object.assign(target, { matches: false, media, onchange: null }, legacy) as MediaQueryList;
  };
}

// The toasts are one stack per page (src/actions/toasts.ts): a case starts
// with none from the one before.
afterEach(() => { clearToasts(); });
