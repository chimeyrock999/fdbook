import type { DocumentStatus } from '@fumadocs-editor/core/sync';
import { useEffect, useRef, useState } from 'react';
import { CURRENT_CR } from '../api/workspace';
import { keepInTab, keptInTab } from '../session-storage';

// A note's text not yet on disk: `base` is the text last known to be there
// (what `text` was edited from), `savedMs` when it was kept.
export type Unsaved = { text: string; base: string; savedMs: number };

// Per person and worktree: the same note in two change requests is two
// notes, and someone signing in after another on this tab is not offered
// the other's edits. `who` is the login, or '_' with sign-in off.
const keyOf = (who: string, path: string) => `notes-studio:unsaved:${who}:${CURRENT_CR ?? '_main'}:${path}`;

// The page keeps an open note's unsaved text in this tab's sessionStorage,
// so a page that goes away before the save (the web sign-in leaves for
// GitHub, a reload) can offer it back (#121). Losing it (storage off) only
// loses the offer.
export function keepUnsaved(who: string, path: string, unsaved: Unsaved | null) {
  keepInTab(keyOf(who, path), unsaved);
}

export function unsavedOf(who: string, path: string): Unsaved | null {
  const value = keptInTab(keyOf(who, path)) as Partial<Unsaved> | null;
  if (typeof value?.text !== 'string' || typeof value.base !== 'string' || typeof value.savedMs !== 'number') return null;
  return { text: value.text, base: value.base, savedMs: value.savedMs };
}

// What a note left unsaved last time, offered back once it is open again.
// `changed`: the note on disk is no longer what those edits started from.
export type UnsavedOffer = Unsaved & { changed: boolean };

// The statuses in which a closing editor still saves what it holds: its
// document flushes on unmount. Offline, denied or in conflict it cannot.
const FLUSHED: ReadonlySet<DocumentStatus | null> = new Set(['dirty', 'saving', 'synced']);

// How long a text must stay synced before it counts as the disk's. Typed
// text turns the note dirty within the editor's parse delay (300 ms); a
// change merged in from disk stays synced.
const SETTLE_MS = 1500;

// Keeps note `path`'s text while it differs from what is on disk, and drops
// it once it is saved. `disk` is the note as the server sent it when it
// opened (null before); the text on disk then moves on when the status
// turns synced, or when a synced text settles (a change merged in). Text
// set straight in the editor (Source, the frontmatter, a restore) reports
// dirty only after a parse, so the text is compared, not only the status.
// A text kept by an earlier editor of the
// note is offered once the note is open, unless the disk already holds it;
// until the offer is taken or dropped this editor keeps nothing, so the
// offer is not overwritten. `setText` puts restored text in the editor,
// which saves it as any edit.
export function useUnsaved(who: string, path: string, { text, disk, status, setText }: {
  text: string;
  disk: string | null;
  status: DocumentStatus | null;
  setText: (text: string) => void;
}) {
  const [kept] = useState(() => unsavedOf(who, path));
  const [offer, setOffer] = useState<UnsavedOffer | null>(null);
  // Undecided until the note opened: then the kept text is offered or not.
  const [decided, setDecided] = useState(kept === null);
  const base = useRef<string | null>(null);
  const last = useRef<DocumentStatus | null>(null);
  // Whether the stored text is this editor's own (not an offer's).
  const own = useRef(false);

  useEffect(() => {
    if (disk === null) return;
    base.current ??= disk;
    if (decided || kept === null) return;
    if (kept.text === disk) keepUnsaved(who, path, null);
    else setOffer({ ...kept, changed: kept.base !== disk });
    setDecided(true);
  }, [disk, decided, kept, who, path]);

  useEffect(() => {
    const before = last.current;
    last.current = status;
    if (!decided || offer !== null || base.current === null) return;
    if (status === 'synced' && before !== 'synced') base.current = text;
    own.current = text !== base.current;
    keepUnsaved(who, path, own.current ? { text, base: base.current, savedMs: Date.now() } : null);
    if (!own.current || status !== 'synced') return;
    const timer = setTimeout(() => {
      base.current = text;
      own.current = false;
      keepUnsaved(who, path, null);
    }, SETTLE_MS);
    return () => { clearTimeout(timer); };
  }, [decided, offer, status, text, who, path]);

  // A closing editor saves what it holds unless the session or a conflict
  // stops it; its text kept then would be offered after it was saved.
  useEffect(() => () => {
    if (own.current && FLUSHED.has(last.current)) keepUnsaved(who, path, null);
  }, [who, path]);

  const settle = () => {
    keepUnsaved(who, path, null);
    setOffer(null);
  };
  return {
    offer,
    restore: () => {
      if (offer === null) return;
      settle();
      setText(offer.text);
    },
    discard: settle,
  };
}
