// Which worktree this page edits. `?cr=<slug>` opens a change request,
// served under /cr/<slug>/ (server/workspace.ts); without it the page reads
// main. Switching loads the page again, so every client made on this page
// talks to one worktree.
import { isCrSlug } from '../../server/cr/slug';

export function crFromSearch(search: string): string | null {
  const cr = new URLSearchParams(search).get('cr');
  return cr !== null && isCrSlug(cr) ? cr : null;
}

export const workspaceBase = (cr: string | null) => (cr === null ? '' : `/cr/${cr}`);

// The change request this page edits, or null for main (and outside a
// browser, where tests load the clients).
export const CURRENT_CR = typeof window === 'undefined' ? null : crFromSearch(window.location.search);
// What the API clients put before /api/….
export const API_BASE = workspaceBase(CURRENT_CR);

// `?chat=<id>` opens that agent chat in the panel (a link from a chat on
// main to the one it started in a change request, and back).
export function chatFromSearch(search: string): string | null {
  const chat = new URLSearchParams(search).get('chat');
  return chat !== null && /^[a-z0-9-]+$/.test(chat) ? chat : null;
}
export const OPENED_CHAT = typeof window === 'undefined' ? null : chatFromSearch(window.location.search);

// The page of a chat: main, or a change request, with the chat open.
export const chatHref = (cr: string | null, chat: string) => `/?${cr === null ? '' : `cr=${cr}&`}chat=${chat}`;
