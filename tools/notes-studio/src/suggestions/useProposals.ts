import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DeleteProposalView, NoteComment, ProposalOp, ProposalsClient, ProposalView } from '../api/proposals';
import { toast } from '../actions/toasts';
import { NOTES_PREFIX } from '../notes/notes';

// The proposals, delete proposals and comments of the change request the page edits (`inCr`),
// kept up to date from the server's stream, and the actions on them. A
// failed read says why in a toast; a failed action throws, for the button
// that sent it (useNoteSuggestions).
export function useProposals(client: ProposalsClient, inCr: boolean) {
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [comments, setComments] = useState<NoteComment[]>([]);
  const [deletes, setDeletes] = useState<DeleteProposalView[]>([]);

  const reload = useCallback(async () => {
    if (!inCr) return;
    try {
      const [list, notes, deleteList] = await Promise.all([client.list(), client.comments(), client.listDeletes()]);
      setProposals(list);
      setComments(notes);
      setDeletes(deleteList);
    } catch (reason) {
      toast.error(reason);
    }
  }, [client, inCr]);

  const merge = useCallback((proposal: ProposalView) => {
    setProposals((current) => {
      const others = current.filter((each) => each.id !== proposal.id);
      return [...others, proposal].sort((a, b) => a.createdMs - b.createdMs);
    });
  }, []);

  const mergeDelete = useCallback((proposal: DeleteProposalView) => {
    setDeletes((current) => [...current.filter((each) => each.id !== proposal.id), proposal].sort((a, b) => a.createdMs - b.createdMs));
  }, []);

  useEffect(() => {
    if (!inCr) return undefined;
    return client.subscribe(merge, () => { void reload(); }, (comment) => {
      setComments((current) => (current.some((each) => each.id === comment.id) ? current : [...current, comment]));
    }, ({ id }) => {
      setComments((current) => current.filter((comment) => comment.id !== id));
    }, mergeDelete);
  }, [client, inCr, merge, mergeDelete, reload]);

  const resolveComment = useCallback(async (id: string) => {
    await client.resolveComment(id);
    setComments((current) => current.filter((comment) => comment.id !== id));
  }, [client]);

  const act = useCallback(async (id: string, op: ProposalOp, hunks?: string[]) => {
    merge(await client.act(id, op, hunks));
  }, [client, merge]);

  // Accepts (with the base of the dry run shown) or rejects a delete proposal.
  const actOnDelete = useCallback(async (id: string, op: 'accept' | 'reject', base?: string) => {
    mergeDelete(await client.actOnDelete(id, op, base));
  }, [client, mergeDelete]);

  // The open delete proposals, by the page or folder they would delete
  // (relative to content/notes, the tree's paths).
  const deleting = useMemo(() => new Map(deletes.filter((proposal) => proposal.state === 'open').map((proposal) => [proposal.path, proposal])), [deletes]);

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
    deleting,
    act,
    actOnDelete,
    resolveComment,
    reload,
  };
}

export type Proposals = ReturnType<typeof useProposals>;
