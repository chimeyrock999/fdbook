import { Check, ChevronLeft, ChevronRight, MessageSquare, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AGENT_NAMES, type AgentId } from '../../server/agents/shared';
import { useShownAfter } from '../actions/busy';
import { PendingButton, Spinner } from '../actions/PendingButton';
import { AgentLogo } from '../agents/AgentLogo';
import type { NoteComment, ProposalOp, ProposalView } from '../api/proposals';
import { diffFrontmatter } from '../diff/diff-blocks';
import { FrontmatterTable, NotePart } from '../diff/RenderedDiff';
import { findBlock } from '../frontmatter/block';
import type { Placement, PlacedHunk } from './places';
import type { Decisions } from './useNoteSuggestions';
import type { SuggestionLayer, VisualMarks } from './visual';

// What the editor needs to show a note's suggestions: its proposals and
// comments, and the action on them (useProposals), which throws when the
// server refuses it. Null without proposals (main, a Studio over one
// worktree).
export type NoteReview = {
  proposals: ProposalView[];
  comments: NoteComment[];
  act: (id: string, op: ProposalOp, hunks?: string[]) => Promise<void>;
};

const VERBS: Record<ProposalOp, string> = { accept: 'Accepting', reject: 'Rejecting', rebase: 'Rebasing', drop: 'Dropping' };

// An agent's name, or its id for one the Studio does not know.
const agentName = (id: string) => (AGENT_NAMES as Partial<Record<string, string>>)[id] ?? id;

const authorName = (proposal: ProposalView) => (proposal.by.kind === 'run' ? agentName(proposal.by.agent) : (proposal.by.login ?? 'You'));

function Author({ proposal }: { proposal: ProposalView }) {
  return (
    <span className="studio-suggest-who">
      {proposal.by.kind === 'run' && <AgentLogo id={proposal.by.agent as AgentId} size={14} />}
      <strong>{authorName(proposal)}</strong>
      {proposal.by.kind === 'run' && proposal.by.model !== null && <span className="studio-suggest-meta">{proposal.by.model}</span>}
    </span>
  );
}

// Over the editor: who proposed, how many suggestions wait (and how many
// are stale), stepping through them, and Accept all / Reject all. Stale
// ones wait for a rebase and are left out of Accept all. While a decision
// is out, every action of the note waits (`decisions`), and the bar says
// what it is doing.
export function SuggestionBar({ placement, focus, onStep, decisions }: { placement: Placement; focus: string | null; onStep: (by: number) => void; decisions: Decisions }) {
  const { busy, deciding, landing, decide } = decisions;
  const shown = useShownAfter(deciding !== null && deciding.keys.size > 1);
  // A card landing is accepted already: not counted, not decided again.
  const placed = placement.hunks.filter((hunk) => !landing.has(hunk.key));
  const waiting = placed.length + placement.lost.length;
  if (waiting === 0) return null;
  const stale = placed.filter((hunk) => hunk.stale).length + placement.lost.length;
  const open = placed.filter((hunk) => !hunk.stale);
  const proposals = [...new Map([...placement.hunks, ...placement.lost].map((each) => [each.proposal.id, each.proposal])).values()];
  const summary = proposals.map((proposal) => proposal.summary).find((each) => each !== null) ?? null;
  const at = focus === null ? 0 : placement.hunks.findIndex((hunk) => hunk.key === focus) + 1;
  const many = deciding !== null && deciding.keys.size > 1;
  const pending = (op: ProposalOp) => many && deciding.op === op;
  return (
    <div className="studio-suggest-bar" role="region" aria-label="Suggestions">
      {proposals.length === 1 ? <Author proposal={proposals[0]} /> : <span className="studio-suggest-who"><strong>{proposals.length} proposals</strong></span>}
      {waiting > 0 && <span className="studio-suggest-chip">{waiting === 1 ? '1 suggestion' : `${String(waiting)} suggestions`}</span>}
      {stale > 0 && <span className="studio-suggest-chip" data-tone="warning">{stale} stale</span>}
      {summary !== null && <span className="studio-suggest-summary" title={summary}>{summary}</span>}
      {placement.hunks.length > 0 && (
        <span className="studio-suggest-nav">
          <button type="button" className="studio-suggest-icon" aria-label="Previous suggestion" onClick={() => { onStep(-1); }}><ChevronLeft size={14} aria-hidden /></button>
          <span>{at} / {placement.hunks.length}</span>
          <button type="button" className="studio-suggest-icon" aria-label="Next suggestion" onClick={() => { onStep(1); }}><ChevronRight size={14} aria-hidden /></button>
        </span>
      )}
      {placement.lost.length > 0 && (
        <span className="studio-suggest-lost">
          {placement.lost.length === 1 ? '1 suggestion has nowhere to go: the blocks around it are gone.' : `${String(placement.lost.length)} suggestions have nowhere to go.`}
          <PendingButton className="studio-button" pending={pending('drop')} pendingLabel="Dropping…" disabled={busy} onClick={() => { void decide(placement.lost, 'drop'); }}>Drop</PendingButton>
        </span>
      )}
      <span className="flex-1" />
      {shown && deciding !== null && <span className="studio-suggest-meta studio-suggest-progress" role="status"><Spinner /> {VERBS[deciding.op]} {deciding.keys.size} suggestions…</span>}
      {waiting > 0 && (
        <>
          <PendingButton className="studio-button" pending={pending('reject')} pendingLabel={null} disabled={busy} onClick={() => { void decide([...placed, ...placement.lost], 'reject'); }}>Reject all</PendingButton>
          <PendingButton className="studio-button studio-button-primary gap-1.5" pending={pending('accept')} pendingLabel={null} disabled={busy || open.length === 0} title={stale > 0 ? 'Stale suggestions wait for a rebase' : undefined} onClick={() => { void decide(open, 'accept'); }}>
            <Check size={13} aria-hidden /> Accept all
          </PendingButton>
        </>
      )}
    </div>
  );
}

// What a hunk puts there: its frontmatter keys, or its blocks rendered as
// the editor renders them, or that it only removes.
function Proposed({ hunk }: { hunk: PlacedHunk }) {
  const added = hunk.hunk.added.trim();
  if (findBlock(hunk.hunk.added.trimStart()) !== null || findBlock(hunk.hunk.removed.trimStart()) !== null) {
    const before = hunk.hunk.removed.trimStart();
    const after = hunk.hunk.added.trimStart();
    const body = after.slice(findBlock(after)?.end ?? 0).trim();
    return (
      <>
        <FrontmatterTable changes={diffFrontmatter(before, after)} added={false} />
        {body !== '' && <NotePart source={body} />}
      </>
    );
  }
  if (added === '') return <p className="studio-suggest-meta">Removes {hunk.count === 1 ? 'this block' : `these ${String(hunk.count)} blocks`}.</p>;
  return <NotePart key={added} source={added} />;
}

// A suggestion's card. While a decision on it is out, or it is accepted
// and its text is not in the editor yet (`landing`), it says so and waits.
function Card({ hunk, index, total, readOnly, decisions }: { hunk: PlacedHunk; index: number; total: number; readOnly: boolean; decisions: Decisions }) {
  const { busy, deciding, landing, decide } = decisions;
  const op: ProposalOp | null = landing.has(hunk.key) ? 'accept' : deciding?.keys.has(hunk.key) ? deciding.op : null;
  const shown = useShownAfter(op !== null);
  const act = (next: ProposalOp) => { void decide([hunk], next); };
  const pending = (each: ProposalOp) => op === each;
  return (
    <div className="studio-suggest-body" data-busy={op !== null || undefined} aria-busy={op !== null || undefined} aria-label={`Suggestion ${String(index)} of ${String(total)} from ${authorName(hunk.proposal)}`}>
      {!readOnly && (
        <div className="studio-suggest-acts">
          {shown && op !== null && <span className="studio-suggest-busy" role="status"><Spinner /> {VERBS[op]}…</span>}
          <span className="studio-suggest-meta">{index} / {total}</span>
          <PendingButton className="studio-suggest-icon" data-tone="success" aria-label="Accept suggestion" pending={pending('accept')} pendingLabel={null} disabled={busy || op !== null || hunk.stale} onClick={() => { act('accept'); }}><Check size={14} aria-hidden /></PendingButton>
          <PendingButton className="studio-suggest-icon" data-tone="error" aria-label="Reject suggestion" pending={pending('reject')} pendingLabel={null} disabled={busy || op !== null} onClick={() => { act('reject'); }}><X size={14} aria-hidden /></PendingButton>
        </div>
      )}
      <div className="studio-visual"><Proposed hunk={hunk} /></div>
      {hunk.stale && (
        <p className="studio-suggest-stale-note">
          This part of the note changed since the suggestion was made.
          {!readOnly && (
            <>
              <PendingButton className="studio-button" pending={pending('rebase')} pendingLabel="Rebasing…" disabled={busy || op !== null} onClick={() => { act('rebase'); }}>Rebase</PendingButton>
              <PendingButton className="studio-button" data-tone="error" pending={pending('drop')} pendingLabel="Dropping…" disabled={busy || op !== null} onClick={() => { act('drop'); }}>Drop</PendingButton>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Bubble({ comment }: { comment: NoteComment }) {
  const [open, setOpen] = useState(false);
  const who = comment.by.kind === 'run' ? agentName(comment.by.agent) : (comment.by.login ?? 'You');
  return (
    <>
      <button type="button" className="studio-suggest-icon" aria-expanded={open} aria-label={`Comment from ${who}`} onClick={() => { setOpen(!open); }}>
        <MessageSquare size={13} aria-hidden />
      </button>
      {open && <div className="studio-suggest-comment-pop" role="note"><strong>{who}</strong><p>{comment.body}</p></div>}
    </>
  );
}

// The cards and comment bubbles, drawn into the elements the editor plugin
// placed (visual.ts), and the plugin told where they go.
export function VisualSuggestions({ layer, placement, focus, readOnly, decisions }: { layer: SuggestionLayer; placement: Placement; focus: string | null; readOnly: boolean; decisions: Decisions }) {
  const placedComments = placement.comments.filter((each): each is { comment: NoteComment; block: number } => each.block !== null);
  const marks: VisualMarks = {
    hunks: placement.hunks.map((hunk) => ({ key: hunk.key, first: hunk.first, count: hunk.count, stale: hunk.stale, focus: hunk.key === focus })),
    comments: placedComments.map(({ comment, block }) => ({ key: comment.id, block })),
  };
  // Only when what is marked changes: each set redraws the editor.
  const marked = JSON.stringify(marks);
  useEffect(() => {
    layer.set(JSON.parse(marked) as VisualMarks);
  }, [layer, marked]);
  useEffect(() => () => { layer.set({ hunks: [], comments: [] }); }, [layer]);
  const portals: ReactNode[] = placement.hunks.map((hunk, index) =>
    createPortal(<Card hunk={hunk} index={index + 1} total={placement.hunks.length} readOnly={readOnly} decisions={decisions} />, layer.element(hunk.key, 'studio-suggest-card'), hunk.key),
  );
  for (const { comment } of placedComments) portals.push(createPortal(<Bubble comment={comment} />, layer.element(`c:${comment.id}`, 'studio-suggest-comment'), comment.id));
  return <>{portals}</>;
}

// Comments on the note as a whole, or on a block that is gone: under the bar.
export function NoteComments({ placement }: { placement: Placement }) {
  const loose = placement.comments.filter((each) => each.block === null);
  if (loose.length === 0) return null;
  return (
    <ul className="studio-suggest-notes" aria-label="Comments on the note">
      {loose.map(({ comment }) => (
        <li key={comment.id}><MessageSquare size={13} aria-hidden /> <strong>{comment.by.kind === 'run' ? agentName(comment.by.agent) : (comment.by.login ?? 'You')}</strong> {comment.body}</li>
      ))}
    </ul>
  );
}
