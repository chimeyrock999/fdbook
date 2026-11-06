import { CircleAlert } from 'lucide-react';
import { timeAgo } from '#changes/labels.ts';
import { useCopy } from '#clipboard.ts';
import type { UnsavedOffer } from './unsaved';

// Edits an earlier editor of this note could not save (the page went away
// while the session had ended, #121), offered back once the note is open.
// It stays until a choice is made: Restore puts them in the editor, which
// saves them; someone who may not write can copy them instead.
export function UnsavedNotice({ offer, writable, onRestore, onDiscard }: {
  offer: UnsavedOffer;
  writable: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const { copied, ref, copy } = useCopy<HTMLPreElement>(offer.text);
  return (
    <div role="status" className="studio-popup studio-unsaved-notice">
      <CircleAlert size={16} aria-hidden="true" />
      <div>
        <p>
          <b>Edits made before your session ended were not saved</b> ({timeAgo(new Date(offer.savedMs).toISOString())}).
        </p>
        {offer.changed && writable && <p className="studio-unsaved-changed">The note changed since. Restoring puts your version over those changes; History has theirs.</p>}
        {!writable && (
          <>
            <p>You can no longer edit this note. Copy your edits to keep them.</p>
            <pre ref={ref} className="studio-unsaved-text">{offer.text}</pre>
            {copied === 'blocked' && <p role="alert">This browser blocked copying. The text is selected: copy it with Ctrl+C (⌘C on a Mac).</p>}
          </>
        )}
        <p className="studio-leave-actions">
          {writable ? (
            <button type="button" className="studio-changes-link" onClick={onRestore}>Restore edits</button>
          ) : (
            <button type="button" className="studio-changes-link" onClick={copy}>{copied === true ? 'Copied' : 'Copy edits'}</button>
          )}
          <button type="button" className="studio-changes-link" data-quiet onClick={onDiscard}>Discard</button>
        </p>
      </div>
    </div>
  );
}
