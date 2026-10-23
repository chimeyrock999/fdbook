import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBusy } from '../actions/busy';
import type { NoteComment, ProposalHunk, ProposalOp, ProposalView } from '../api/proposals';
import { placeAll, type PlacedHunk, type Placement } from './places';
import type { NoteReview } from './Suggestions';

const NONE: ProposalView[] = [];
const NONE_COMMENTED: NoteComment[] = [];
const EMPTY: Placement = { hunks: [], lost: [], comments: [], parsed: true };

// How long an accepted hunk stays on the text it was accepted on, waiting
// for the write to reach the editor (sync) after the proposal says so.
export const LANDING_MS = 3000;

type Decidable = { key: string; proposal: ProposalView; hunk: ProposalHunk };

// The note's decisions on its suggestions (#138): one at a time for the
// whole note, so Accept all and a card never overlap. `deciding`: the hunks
// a request is out for, and how. An accepted hunk keeps its card, marked
// as landing, until its text is in the editor (or LANDING_MS), so the card
// never goes before the text comes. A landing hunk is decided already:
// `decide` leaves it out, and so does `open` (what Accept all, Reject all
// and Source offer).
export type Decisions = {
  busy: boolean;
  deciding: { keys: ReadonlySet<string>; op: ProposalOp } | null;
  landing: ReadonlySet<string>;
  // One request per proposal; resolves whether every one went.
  decide: (hunks: Decidable[], op: ProposalOp) => Promise<boolean>;
};

type Held = { hunks: PlacedHunk[]; text: string };

// The note's suggestions placed on its text as it is now, which one is in
// focus, stepping through them, and deciding them.
export function useNoteSuggestions(review: NoteReview | null, text: string) {
  const proposals = review?.proposals ?? NONE;
  const comments = review?.comments ?? NONE_COMMENTED;
  // Nothing to place, nothing to parse: typing in a note without
  // suggestions costs nothing here.
  const placed = useMemo(() => (proposals.length === 0 && comments.length === 0 ? EMPTY : placeAll(text, proposals, comments)), [text, proposals, comments]);
  const action = useBusy();
  const [deciding, setDeciding] = useState<Decisions['deciding']>(null);
  const [held, setHeld] = useState<Held | null>(null);
  // What `decide` reads when it runs, so it is one function for the page.
  const latest = useRef<{ text: string; review: NoteReview | null; placed: Placement; landing: ReadonlySet<string> }>({ text, review, placed, landing: new Set() });
  useEffect(() => {
    if (held === null) return undefined;
    const timer = setTimeout(() => { setHeld(null); }, LANDING_MS);
    return () => { clearTimeout(timer); };
  }, [held]);

  // Held cards only while the editor still has the text they were placed on.
  const landing = useMemo(() => {
    if (held?.text !== text) return [];
    const shown = new Set(placed.hunks.map((hunk) => hunk.key));
    return held.hunks.filter((hunk) => !shown.has(hunk.key));
  }, [held, text, placed]);
  const placement = useMemo(() => (landing.length === 0 ? placed : { ...placed, hunks: [...placed.hunks, ...landing].sort((a, b) => a.from - b.from) }), [placed, landing]);
  const landingKeys = useMemo(() => new Set(landing.map((hunk) => hunk.key)), [landing]);
  useEffect(() => { latest.current = { text, review, placed, landing: landingKeys }; });

  const { run } = action;
  const decide = useCallback((hunks: Decidable[], op: ProposalOp) => run(async () => {
    const { review: now, landing: decided } = latest.current;
    const chosen = hunks.filter((each) => !decided.has(each.key));
    if (now === null || chosen.length === 0) return;
    const byProposal = new Map<string, Decidable[]>();
    for (const each of chosen) byProposal.set(each.proposal.id, [...(byProposal.get(each.proposal.id) ?? []), each]);
    setDeciding({ keys: new Set(chosen.map((each) => each.key)), op });
    try {
      for (const [id, group] of byProposal) {
        const keys = new Set(group.map((each) => each.key));
        // Held from before the request (the stream may say it is decided
        // first), along with what earlier proposals of this decision hold.
        if (op === 'accept') {
          const { text: on, placed: shown } = latest.current;
          setHeld((before) => ({ hunks: [...(before?.text === on ? before.hunks : []), ...shown.hunks.filter((hunk) => keys.has(hunk.key))], text: on }));
        }
        try {
          await now.act(id, op, group.map((each) => each.hunk.id));
        } catch (reason) {
          // Only this proposal's hunks go back: the others went.
          setHeld((before) => (before === null ? null : { ...before, hunks: before.hunks.filter((hunk) => !keys.has(hunk.key)) }));
          throw reason;
        }
      }
    } finally {
      setDeciding(null);
    }
  }, op), [run]);

  const [focus, setFocus] = useState<string | null>(null);
  const keys = placement.hunks.map((hunk) => hunk.key);
  const current = focus !== null && keys.includes(focus) ? focus : (keys[0] ?? null);
  const step = (by: number) => {
    if (keys.length === 0) return;
    const next = keys[(Math.max(0, keys.indexOf(current)) + by + keys.length) % keys.length];
    setFocus(next);
    return next;
  };
  const decisions: Decisions = { busy: action.busy, deciding, landing: landingKeys, decide };
  // What can still be decided: the hunks placed, not those landing.
  const open = placed.hunks;
  return { placement, open, focus: current, setFocus, step, decisions };
}
