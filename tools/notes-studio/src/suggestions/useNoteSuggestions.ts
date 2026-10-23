import { useMemo, useState } from 'react';
import type { NoteComment, ProposalView } from '../api/proposals';
import { placeAll, type Placement } from './places';

const NONE: ProposalView[] = [];
const NONE_COMMENTED: NoteComment[] = [];
const EMPTY: Placement = { hunks: [], lost: [], comments: [], parsed: true };
import type { NoteReview } from './Suggestions';

// The note's suggestions placed on its text as it is now, which one is in
// focus, and stepping through them.
export function useNoteSuggestions(review: NoteReview | null, text: string) {
  const proposals = review?.proposals ?? NONE;
  const comments = review?.comments ?? NONE_COMMENTED;
  // Nothing to place, nothing to parse: typing in a note without
  // suggestions costs nothing here.
  const placement = useMemo(() => (proposals.length === 0 && comments.length === 0 ? EMPTY : placeAll(text, proposals, comments)), [text, proposals, comments]);
  const [focus, setFocus] = useState<string | null>(null);
  const keys = placement.hunks.map((hunk) => hunk.key);
  const current = focus !== null && keys.includes(focus) ? focus : (keys[0] ?? null);
  const step = (by: number) => {
    if (keys.length === 0) return;
    const next = keys[(Math.max(0, keys.indexOf(current)) + by + keys.length) % keys.length];
    setFocus(next);
    return next;
  };
  return { placement, focus: current, setFocus, step };
}
