import { Unplug } from 'lucide-react';
import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { disconnected, onDisconnect, type Disconnect } from '../api/connection';

const WHY: Record<Disconnect['reason'], string> = {
  'unreachable': 'The Studio server can’t be reached. It may have stopped or restarted.',
  'cr-closed': 'This change request is closing or was closed, so its workspace is gone.',
  'refused': 'The Studio server refused the connection.',
};

// Over the whole page once the connection watch gave up (#150): nothing can
// be saved, so it cannot be dismissed and everything else on the page (the
// Studio, the sign-in, what they portal into the body, now or later) is
// inert until the reload. Unsaved note text is kept per person in this tab
// (src/editor/unsaved.ts), so the reload offers it back.
export function ServerDisconnected() {
  const lost = useSyncExternalStore(onDisconnect, disconnected);
  const titleId = useId();
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = frame.current;
    if (lost === null || dialog === null) return;
    dialog.focus();
    // What is portalled into the body later (a toast, a menu, the sign-in)
    // is made inert too.
    const others = new Set<HTMLElement>();
    const quiet = (elements: Iterable<Node>) => {
      for (const element of elements) {
        if (!(element instanceof HTMLElement) || element.inert || element.contains(dialog)) continue;
        element.inert = true;
        others.add(element);
      }
    };
    quiet(document.body.children);
    const added = new MutationObserver((records) => { for (const record of records) quiet(record.addedNodes); });
    added.observe(document.body, { childList: true });
    return () => {
      added.disconnect();
      for (const element of others) element.inert = false;
    };
  }, [lost]);
  if (lost === null) return null;
  return createPortal(
    <div ref={frame} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-why`} className="studio-signin studio-signin-over">
      <div className="studio-signin-card">
        <h1 id={titleId} className="studio-disconnected-title"><Unplug size={18} aria-hidden /> Server disconnected</h1>
        <p id={`${titleId}-why`}>{WHY[lost.reason]}{lost.reason === 'refused' && lost.detail !== '' && <> <b>{lost.detail}</b></>}</p>
        <p>Nothing can be saved until the page reloads. <b>Unsaved text in open notes is kept in this tab</b> and offered back after the reload.</p>
        <button type="button" className="studio-button studio-button-primary studio-signin-button" onClick={() => { window.location.reload(); }}>Reload</button>
      </div>
    </div>,
    document.body,
  );
}
