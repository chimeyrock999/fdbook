import { MessageSquare, Unlink } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { blocksOf } from '@fdbook/shared/hunks.ts';
import { anchorAt, locate } from '@fdbook/shared/anchors.ts';
import { THREAD_SEVERITIES } from '@fdbook/shared/review.ts';
import { useBusy } from '#components/busy.ts';
import { PendingButton } from '#components/PendingButton.tsx';
import type { Thread, ThreadSeverity } from '#api/proposals.ts';
import type { Placement } from './places';
import type { SuggestionLayer } from './visual';
import { setCommentDraft, useCommentDraft } from './comment-draft';
import { useFloatBy } from './float';
import { SeverityChip } from './labels';
import { ThreadCard } from './ThreadCard';
import { blockingCount, nameOf, openerOf, SEVERITY_LABELS, threadGroups, type NoteThreadActions, type ThreadActions, type ThreadFocus } from './texts';

// What a new thread says: its text and severity, from the format bubble's
// Comment (on a block) or the strip over the note (on the whole note).
export function Composer({ label, onSubmit, onCancel }: { label: string; onSubmit: (body: string, severity: ThreadSeverity | null) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [severity, setSeverity] = useState<ThreadSeverity | null>(null);
  const action = useBusy();
  const submit = () => { if (text.trim() !== '') void action.run(() => onSubmit(text, severity)); };
  return (
    <div className="studio-review-card studio-review-composer" role="dialog" aria-label={label}>
      <p className="studio-review-hint">{label}</p>
      <textarea
        className="studio-input"
        aria-label="Comment"
        placeholder="What should change?"
        value={text}
        disabled={action.busy}
        autoFocus
        onChange={(event) => { setText(event.target.value); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
          if (event.key === 'Escape') onCancel();
        }}
      />
      <p className="studio-review-actions">
        <select className="studio-input studio-review-select" aria-label="Severity" value={severity ?? ''} onChange={(event) => { setSeverity(event.target.value === '' ? null : (event.target.value as ThreadSeverity)); }}>
          <option value="">{SEVERITY_LABELS.comment}</option>
          {THREAD_SEVERITIES.map((each) => <option key={each} value={each}>{SEVERITY_LABELS[each]}</option>)}
        </select>
        <span className="flex-1" />
        <button type="button" className="studio-button" disabled={action.busy} onClick={onCancel}>Cancel</button>
        <PendingButton className="studio-button studio-button-primary" pending={action.busy} pendingLabel="Commenting…" disabled={text.trim() === ''} onClick={submit}>
          Comment
        </PendingButton>
      </p>
    </div>
  );
}

// A popup on document.body, by `anchor` (useFloatBy).
function Floating({ anchor, onClose, children }: { anchor: HTMLElement; onClose: () => void; children: ReactNode }) {
  const floating = useRef<HTMLDivElement>(null);
  useFloatBy(anchor, floating, onClose);
  return createPortal(<div ref={floating} className="studio-review-pop">{children}</div>, document.body);
}

// One block's mark in the margin: how many comments, red when a blocking
// thread waits (as the Review view counts them), faint when every thread
// is answered. It opens the threads.
function Mark({ threads, readOnly, actions, focus }: { threads: Thread[]; readOnly: boolean; actions: ThreadActions; focus: ThreadFocus | null }) {
  const [open, setOpen] = useState(false);
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const close = useCallback(() => { setOpen(false); }, []);
  // The panel asked for one of these threads: open them, once per ask.
  const asked = focus !== null && threads.some((thread) => thread.id === focus.id) ? focus.seq : null;
  const [seen, setSeen] = useState<number | null>(null);
  if (asked !== null && asked !== seen) {
    setSeen(asked);
    setOpen(true);
  }
  useEffect(() => {
    if (asked !== null) button?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [asked, button]);
  const blocking = blockingCount(threads) > 0;
  const answered = threads.every((thread) => thread.state === 'addressed');
  const count = threads.reduce((total, thread) => total + thread.comments.length, 0);
  const who = nameOf(openerOf(threads[0]));
  return (
    <>
      <button
        ref={setButton}
        type="button"
        className="studio-review-mark"
        data-tone={blocking ? 'blocking' : threads.some((thread) => thread.severity === 'nit') ? 'nit' : undefined}
        data-answered={answered || undefined}
        aria-expanded={open}
        aria-label={`${String(threads.length)} ${threads.length === 1 ? 'thread' : 'threads'}, from ${who}`}
        onClick={() => { setOpen(!open); }}
      >
        <MessageSquare size={13} aria-hidden />
        {count}
      </button>
      {open && button !== null && (
        <Floating anchor={button} onClose={close}>
          {threads.map((thread) => <ThreadCard key={thread.id} thread={thread} readOnly={readOnly} actions={actions} onClose={close} />)}
        </Floating>
      )}
    </>
  );
}

// The block `block` of `text`, anchored (null when the text does not parse
// or has no such block: the document can be a keystroke ahead of it).
function anchorOf(text: string, block: number) {
  try {
    const blocks = blocksOf(text);
    return block < blocks.length ? anchorAt(blocks, block) : null;
  } catch {
    return null;
  }
}

// The comment box the format bubble asked for, by its block. The block is
// anchored when the box opens and found again on the text when it is sent,
// so edits above it meanwhile (a suggestion accepted, another person) do
// not move the comment to another block.
function DraftBox({ host, block, text, actions }: { host: HTMLElement; block: number; text: string; actions: NoteThreadActions }) {
  const cancel = useCallback(() => { setCommentDraft(null); }, []);
  const [asked] = useState(() => anchorOf(text, block));
  return (
    <Floating anchor={host} onClose={cancel}>
      <Composer
        label="Comment on this block"
        onCancel={cancel}
        onSubmit={async (body, severity) => {
          let blocks;
          try {
            blocks = blocksOf(text);
          } catch {
            throw new Error('The note does not parse: fix it, then comment.');
          }
          const found = asked === null ? null : locate(asked, blocks);
          if (found === null) throw new Error('That block is gone: select text again to comment.');
          // The block as the editor holds it now, edits not saved yet included.
          await actions.open(anchorAt(blocks, found), body, severity);
          setCommentDraft(null);
        }}
      />
    </Floating>
  );
}

// The marks and the comment box, drawn into the elements the editor plugin
// placed (visual.ts, keyed `c:<key>` as threadMarks names them).
export function ThreadMarks({ layer, placement, text, readOnly, actions, focus }: { layer: SuggestionLayer; placement: Placement; text: string; readOnly: boolean; actions: NoteThreadActions; focus: ThreadFocus | null }) {
  const draft = useCommentDraft();
  // A draft goes with the note it was for.
  useEffect(() => () => { setCommentDraft(null); }, []);
  const portals: ReactNode[] = threadGroups(placement).map(([, threads]) =>
    createPortal(<Mark threads={threads} readOnly={readOnly} actions={actions} focus={focus} />, layer.element(`c:${threads[0].id}`, 'studio-suggest-comment'), threads[0].id),
  );
  if (draft !== null && !readOnly) portals.push(<DraftBox key={`draft-${String(draft)}`} host={layer.element('c:draft', 'studio-suggest-comment')} block={draft} text={text} actions={actions} />);
  return <>{portals}</>;
}

// Over the note: threads on the note as a whole, and those whose block is
// gone (with what the block said), each opening its thread. A thread on
// the whole note is opened from the Review panel.
export function NoteThreads({ placement, readOnly, actions, focus }: { placement: Placement; readOnly: boolean; actions: ThreadActions; focus: ThreadFocus | null }) {
  const loose = placement.threads.filter((each) => each.block === null).map((each) => each.thread);
  const [shown, setShown] = useState<string | null>(null);
  const asked = focus !== null && loose.some((thread) => thread.id === focus.id) ? focus : null;
  const [seen, setSeen] = useState<number | null>(null);
  if (asked !== null && asked.seq !== seen) {
    setSeen(asked.seq);
    setShown(asked.id);
  }
  const open = loose.find((thread) => thread.id === shown) ?? null;
  if (loose.length === 0) return null;
  return (
    <div className="studio-review-strip">
      <ul aria-label="Threads on the note">
        {loose.map((thread) => (
          <li key={thread.id}>
            <button type="button" className="studio-review-strip-item" aria-expanded={shown === thread.id} onClick={() => { setShown(shown === thread.id ? null : thread.id); }}>
              {thread.anchor === null ? <MessageSquare size={13} aria-hidden /> : <Unlink size={13} aria-hidden />}
              <strong>{nameOf(openerOf(thread))}</strong>
              <SeverityChip severity={thread.severity} />
              <span className="studio-review-strip-body">{thread.comments[0].body}</span>
              {thread.anchor !== null && <q className="studio-review-strip-gone">Block gone: {thread.anchor.text.split('\n')[0]}</q>}
            </button>
          </li>
        ))}
      </ul>
      {open !== null && <ThreadCard thread={open} readOnly={readOnly} actions={actions} onClose={() => { setShown(null); }} />}
    </div>
  );
}
