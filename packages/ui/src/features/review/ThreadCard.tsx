import { Unlink, WandSparkles, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { movesOf, needsReason } from '@fdbook/shared/review.ts';
import { useBusy } from '#components/busy.ts';
import { PendingButton } from '#components/PendingButton.tsx';
import type { Thread, ThreadState } from '#api/proposals.ts';
import { SeverityChip, StateChip, Who } from './labels';
import { MOVE_LABELS, MOVED, type ThreadActions } from './texts';

const clock = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// One thread whole: every comment and move, its suggestion, a reply box and
// the moves a person may make (shared.ts). A rejection takes its reason
// from the reply box. Read only for someone who may not write.
export function ThreadCard({ thread, readOnly, actions, onClose }: { thread: Thread; readOnly: boolean; actions: ThreadActions; onClose?: () => void }) {
  const [text, setText] = useState('');
  const [why, setWhy] = useState(false);
  const action = useBusy();
  const send = (key: string, task: () => Promise<void>) => {
    void action.run(task, key).then((done) => { if (done) setText(''); });
  };
  const reply = () => { if (text.trim() !== '') send('reply', () => actions.reply(thread.id, text)); };
  const move = (state: ThreadState) => {
    if (needsReason(state) && text.trim() === '') {
      setWhy(true);
      return;
    }
    setWhy(false);
    send(state, () => actions.move(thread.id, state, text));
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      reply();
    }
  };
  return (
    <div className="studio-review-card" role="dialog" aria-label="Review thread">
      <header>
        <SeverityChip severity={thread.severity} />
        <StateChip state={thread.state} />
        {thread.rule !== null && <code className="studio-review-rule">{thread.rule}</code>}
        {thread.orphaned && <span className="studio-review-orphan"><Unlink size={12} aria-hidden /> Block gone</span>}
        <span className="flex-1" />
        {onClose && (
          <button type="button" className="studio-suggest-icon" aria-label="Close" onClick={onClose}>
            <X size={13} aria-hidden />
          </button>
        )}
      </header>
      {thread.orphaned && thread.anchor !== null && <blockquote className="studio-review-quote">{thread.anchor.text}</blockquote>}
      <ol className="studio-review-comments">
        {thread.comments.map((comment) => (
          <li key={comment.id}>
            <p className="studio-review-line">
              <Who by={comment.by} />
              {comment.state !== undefined && <span className="studio-review-moved" data-state={comment.state}>{MOVED[comment.state]}</span>}
              <time dateTime={new Date(comment.createdMs).toISOString()}>{clock(comment.createdMs)}</time>
            </p>
            {comment.body !== '' && <p className="studio-review-body">{comment.body}</p>}
          </li>
        ))}
      </ol>
      {thread.suggestion !== null && (
        <p className="studio-review-suggestion">
          <WandSparkles size={13} aria-hidden />
          <span className="flex-1">A suggestion goes with this thread.</span>
          {actions.showSuggestion && <button type="button" className="studio-button" onClick={() => { actions.showSuggestion?.(thread.suggestion ?? ''); }}>Show</button>}
        </p>
      )}
      {!readOnly && (
        <div className="studio-review-reply">
          <textarea
            className="studio-input"
            aria-label="Reply"
            placeholder={why ? 'Say why it is rejected, then Reject again.' : 'Reply… (Enter sends, Shift+Enter for a new line)'}
            aria-invalid={why || undefined}
            value={text}
            disabled={action.busy}
            onChange={(event) => { setText(event.target.value); }}
            onKeyDown={onKey}
          />
          <p className="studio-review-actions">
            {movesOf(thread, 'person').map((state) => (
              <PendingButton key={state} className="studio-button" pending={action.is(state)} disabled={action.busy} onClick={() => { move(state); }}>
                {MOVE_LABELS[state]}
              </PendingButton>
            ))}
            <span className="flex-1" />
            <PendingButton className="studio-button studio-button-primary" pending={action.is('reply')} pendingLabel="Sending…" disabled={action.busy || text.trim() === ''} onClick={reply}>
              Reply
            </PendingButton>
          </p>
        </div>
      )}
    </div>
  );
}
