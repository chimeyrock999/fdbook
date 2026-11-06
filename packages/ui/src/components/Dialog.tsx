import { useEffect, useRef, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { makeOthersInert, trapFocus } from './dialog-focus';

// A modal over the whole Studio: the rest of the page is inert while it is
// open, so the note behind it cannot change, and Tab stays inside. Every
// feature's dialogs are one. While its request is out (`busy`, #138), it
// neither closes nor sends again: Escape, the backdrop and Enter wait.
export function Dialog({ title, busy = false, onClose, onSubmit, children }: { title: string; busy?: boolean; onClose: () => void; onSubmit: () => void; children: ReactNode }) {
  const layer = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => makeOthersInert(layer.current), []);
  // A busy dialog disables what had the focus: once it is free, the focus
  // comes back in, so Tab and Escape work again.
  useEffect(() => {
    const element = form.current;
    if (busy || element === null || element.contains(document.activeElement)) return;
    element.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), button:not(:disabled)')?.focus();
  }, [busy]);
  const close = () => { if (!busy) onClose(); };
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!busy) onSubmit();
  };
  return createPortal(
    <div ref={layer} className="studio-dialog-back" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <form
        ref={form}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={busy || undefined}
        className="studio-dialog"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
          if (event.key === 'Tab') trapFocus(event.currentTarget, event);
        }}
      >
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {children}
      </form>
    </div>,
    document.body,
  );
}
