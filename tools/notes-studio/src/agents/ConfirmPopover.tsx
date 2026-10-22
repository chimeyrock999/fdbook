import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const WIDTH = 240;
const GAP = 4;

// A small confirmation beside the button that asked, portalled to <body>
// like PopupMenu: below it, or above when there is no room. Escape, a press
// outside or Keep closes it, and the focus goes back to the button.
export function ConfirmPopover({ anchor, title, children, confirm, onConfirm, onClose }: {
  anchor: HTMLElement;
  title: string;
  children: ReactNode;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  const [top, setTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const box = anchor.getBoundingClientRect();
    const height = ref.current?.offsetHeight ?? 0;
    setTop(box.bottom + GAP + height > window.innerHeight - 8 ? Math.max(8, box.top - GAP - height) : box.bottom + GAP);
  }, [anchor]);

  useEffect(() => {
    const shut = () => {
      close.current();
      anchor.focus();
    };
    const onEvent = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') shut();
        return;
      }
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) shut();
    };
    window.addEventListener('mousedown', onEvent);
    window.addEventListener('keydown', onEvent);
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      window.removeEventListener('mousedown', onEvent);
      window.removeEventListener('keydown', onEvent);
    };
  }, [anchor]);

  const box = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(box.right - WIDTH, window.innerWidth - WIDTH - 8));
  return createPortal(
    <div ref={ref} role="dialog" aria-label={title} className="studio-agent-confirm" style={{ top: top ?? box.bottom + GAP, left, visibility: top === null ? 'hidden' : undefined }}>
      <strong>{title}</strong>
      <p>{children}</p>
      <div className="studio-agent-confirm-actions">
        <button type="button" className="studio-button" onClick={() => { onClose(); anchor.focus(); }}>Keep</button>
        <button type="button" className="studio-button studio-button-danger" onClick={onConfirm}>{confirm}</button>
      </div>
    </div>,
    document.body,
  );
}
