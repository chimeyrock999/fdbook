import { blocksOf, placeOf, rebased, type Block } from '../../server/proposals/hunks';
import type { NoteComment, ProposalHunk, ProposalView } from '../api/proposals';

// A hunk waiting for a person, set on the note as the editor holds it now
// (the server's own placement, server/proposals/hunks.ts, run on the live
// text, so typing does not wait for a save). `from`..`to` is the text it
// replaces; `first` the index of the first block there (the frontmatter is
// block 0, as in the editor's document) and `count` how many blocks it
// replaces, 0 for an insertion before block `first`. A stale hunk is shown
// where a rebase would set it, on what is there now.
export type PlacedHunk = {
  key: string;
  proposal: ProposalView;
  hunk: ProposalHunk;
  stale: boolean;
  from: number;
  to: number;
  first: number;
  count: number;
};

export type Placement = {
  hunks: PlacedHunk[];
  // Stale hunks whose anchors are gone too: they can only be dropped.
  lost: { key: string; proposal: ProposalView; hunk: ProposalHunk }[];
  // Comments on a block still there, by block index; the rest on the note.
  comments: { comment: NoteComment; block: number | null }[];
  // False when the text does not parse: nothing can be placed.
  parsed: boolean;
};

const keyOf = (proposal: ProposalView, hunk: ProposalHunk) => `${proposal.id}/${hunk.id}`;

function spanOf(blocks: Block[], from: number, to: number) {
  const first = blocks.filter((block) => block.end <= from).length;
  const count = blocks.filter((block) => block.start >= from && block.end <= to).length;
  return { first, count };
}

// Every undecided hunk of `proposals` placed on `text`, in note order.
export function placeAll(text: string, proposals: ProposalView[], comments: NoteComment[] = []): Placement {
  const waiting = proposals.flatMap((proposal) => proposal.hunks.filter((hunk) => hunk.decided === null).map((hunk) => ({ proposal, hunk })));
  let blocks: Block[];
  try {
    blocks = blocksOf(text);
  } catch {
    return { hunks: [], lost: waiting.map((each) => ({ key: keyOf(each.proposal, each.hunk), ...each })), comments: comments.map((comment) => ({ comment, block: null })), parsed: false };
  }
  const hunks: PlacedHunk[] = [];
  const lost: Placement['lost'] = [];
  for (const { proposal, hunk } of waiting) {
    const place = placeOf(hunk, text, blocks);
    if (place !== null) {
      hunks.push({ key: keyOf(proposal, hunk), proposal, hunk, stale: false, ...place, ...spanOf(blocks, place.from, place.to) });
      continue;
    }
    const moved = rebased(hunk, text, blocks);
    const at = moved === null ? null : placeOf(moved, text, blocks);
    if (moved === null || at === null) lost.push({ key: keyOf(proposal, hunk), proposal, hunk });
    else hunks.push({ key: keyOf(proposal, hunk), proposal, hunk, stale: true, ...at, ...spanOf(blocks, at.from, at.to) });
  }
  hunks.sort((a, b) => a.from - b.from || a.to - b.to);
  const placedComments = comments.map((comment) => {
    if (comment.block === null) return { comment, block: null };
    const same = blocks.map((block, index) => (block.text === comment.block?.text ? index : -1)).filter((index) => index !== -1);
    const nearest = same.reduce<number | null>((best, index) => (best === null || Math.abs(index - (comment.block?.index ?? 0)) < Math.abs(best - (comment.block?.index ?? 0)) ? index : best), null);
    return { comment, block: nearest };
  });
  return { hunks, lost, comments: placedComments, parsed: true };
}
