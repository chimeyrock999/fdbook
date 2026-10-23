import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NoteComment, ProposalOp, ProposalsClient, ProposalView } from '../api/proposals';
import { NOTES_PREFIX } from '../notes/notes';

// The proposals and comments of the change request the page edits (`inCr`),
// kept up to date from the server's stream, and the actions on them.
export function useProposals(client: ProposalsClient, inCr: boolean) {
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [comments, setComments] = useState<NoteComment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!inCr) return;
    try {
      const [list, notes] = await Promise.all([client.list(), client.comments()]);
      setProposals(list);
      setComments(notes);
      setError(null);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [client, inCr]);

  const merge = useCallback((proposal: ProposalView) => {
    setProposals((current) => {
      const others = current.filter((each) => each.id !== proposal.id);
      return [...others, proposal].sort((a, b) => a.createdMs - b.createdMs);
    });
  }, []);

  useEffect(() => {
    if (!inCr) return undefined;
    return client.subscribe(merge, () => { void reload(); }, (comment) => {
      setComments((current) => (current.some((each) => each.id === comment.id) ? current : [...current, comment]));
    });
  }, [client, inCr, merge, reload]);

  const act = useCallback(async (id: string, op: ProposalOp, hunks?: string[]) => {
    try {
      merge(await client.act(id, op, hunks));
      setError(null);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [client, merge]);

  // Undecided hunks per note, by path relative to content/notes (the tree's).
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const proposal of proposals) {
      const waiting = proposal.hunks.filter((hunk) => hunk.decided === null).length;
      if (waiting > 0) map.set(proposal.path.slice(NOTES_PREFIX.length), (map.get(proposal.path.slice(NOTES_PREFIX.length)) ?? 0) + waiting);
    }
    return map;
  }, [proposals]);

  return {
    proposals,
    comments,
    counts,
    error,
    clearError: () => { setError(null); },
    act,
  };
}

export type Proposals = ReturnType<typeof useProposals>;
