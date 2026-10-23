import { ArrowUp } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { composing } from '../keyboard';

// The message box at the bottom of the agent panel. Enter sends, as in
// other chat panels; Shift+Enter adds a line; Enter that confirms an IME's
// text (Telex) only confirms it. It grows with its text
// up to a few lines (agents.css), then scrolls, and keeps its focus after
// sending. `busy`: the agent is answering, so typing goes on but nothing
// sends. `onSend` resolves whether the message went, to clear the box.
export function Composer({ placeholder, busy, onSend, children }: { placeholder: string; busy: boolean; onSend: (text: string) => Promise<boolean>; children?: ReactNode }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const blocked = busy || sending || text.trim() === '';

  useLayoutEffect(() => {
    const area = box.current;
    if (area === null) return;
    area.style.height = 'auto';
    area.style.height = `${String(area.scrollHeight)}px`;
  }, [text]);

  const send = () => {
    if (blocked) return;
    setSending(true);
    onSend(text).then((sent) => { if (sent) setText(''); }, () => undefined).finally(() => {
      setSending(false);
      box.current?.focus();
    });
  };

  return (
    <form className="studio-agent-composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
      <textarea
        ref={box}
        id="studio-agent-prompt"
        rows={1}
        aria-label="Message"
        placeholder={placeholder}
        value={text}
        onChange={(event) => { setText(event.target.value); }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || composing(event)) return;
          event.preventDefault();
          send();
        }}
      />
      <div className="studio-agent-composer-row">
        {children}
        <span className="flex-1" />
        <button type="submit" className="studio-agent-send" aria-label="Send" title="Send" disabled={blocked}>
          <ArrowUp size={14} aria-hidden />
        </button>
      </div>
    </form>
  );
}
