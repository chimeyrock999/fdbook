import { CircleAlert, TriangleAlert } from 'lucide-react';
import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { currentToasts, dismissToast, subscribeToasts } from './toasts';

// The toasts, at the top right under the header. `children` go first: a
// notice with actions of its own (LeaveNotice) shares the stack. On <body>,
// over a dialog and left out of what it makes inert (dialog-focus.ts): the
// error of a dialog's action shows while the dialog stays open.
export function ToastStack({ children }: { children?: ReactNode }) {
  const toasts = useSyncExternalStore(subscribeToasts, currentToasts);
  if (toasts.length === 0 && (children === undefined || children === null || children === false)) return null;
  return createPortal(
    <div className="studio-toasts" data-studio-toasts>
      {children}
      {toasts.map((each) => (
        <div key={each.id} role={each.tone === 'error' ? 'alert' : 'status'} className="studio-popup studio-toast" data-tone={each.tone}>
          {each.tone === 'error' ? <CircleAlert size={16} aria-hidden /> : <TriangleAlert size={16} aria-hidden />}
          <div>
            <p>{each.message}</p>
            <p className="studio-toast-actions">
              <button type="button" className="studio-changes-link" data-quiet onClick={() => { dismissToast(each.id); }}>Dismiss</button>
            </p>
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}
