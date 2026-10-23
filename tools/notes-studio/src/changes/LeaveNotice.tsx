import { CircleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { plural } from '../assets/asset-changes';
import { TOAST_MS } from '../actions/toasts';
import type { Leave } from './leave';

// The reminder that a change request was left with uncommitted files. It
// blocks nothing: the files stay in that change request's worktree, and the
// toast goes after a few seconds. The page a switch opens shows it, on top
// of the toast stack (App, ToastStack).
// Discard needs none: its dialog lists the uncommitted files it removes.
export function LeaveNotice({ notice, onBack, onClose }: { notice: Leave; onBack: () => void; onClose: () => void }) {
  // The latest onClose, so a parent's render does not restart the timer.
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const timer = setTimeout(() => { close.current(); }, TOAST_MS);
    return () => { clearTimeout(timer); };
  }, [notice]);
  return (
    <div role="status" className="studio-popup studio-toast studio-leave-notice" data-leaves>
      <CircleAlert size={16} aria-hidden="true" />
      <div>
        <p>
          <b>{plural(notice.count, 'file')}</b> in <code>{notice.branch}</code> {notice.count === 1 ? 'is' : 'are'} not committed. They stay in that change request.
        </p>
        <p className="studio-toast-actions">
          <button type="button" className="studio-changes-link" onClick={onBack}>Back to {notice.branch}</button>
          <button type="button" className="studio-changes-link" data-quiet onClick={onClose}>Dismiss</button>
        </p>
      </div>
    </div>
  );
}
