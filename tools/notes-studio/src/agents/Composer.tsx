import { ArrowUp, AtSign, Paperclip } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ATTACHMENT_MAX_BYTES, SELECTION_MAX } from '../../server/agents/shared';
import { useBusy } from '../actions/busy';
import { PendingButton } from '../actions/PendingButton';
import { toast } from '../actions/toasts';
import { composing } from '../keyboard';
import type { Attachment, Mention, MessageContext, MessageSelection } from '../api/agents';
import { AttachmentChip, CaretChip, MentionChip, SelectionChip } from './ContextChips';
import { mentionAt } from './context-labels';
import { useEditorPlace } from './editor-place';
import { MentionList } from './MentionList';

// What the composer needs to add context: mentions to look up and
// documents to keep (src/api/agents.ts).
export type ContextClient = {
  mentions: (query: string) => Promise<Mention[]>;
  attach: (file: File) => Promise<Attachment>;
};

// The message box at the bottom of the agent panel. Enter sends, as in
// other chat panels; Shift+Enter adds a line; Enter that confirms an IME's
// text (Telex) only confirms it. It grows with its text
// up to a few lines (agents.css), then scrolls, and keeps its focus after
// sending. `busy`: the agent is answering, so typing goes on but nothing
// sends. The box empties as the message goes (the thread shows it on its
// way, AgentPanel); `onSend` resolves whether it went, and a message that
// did not comes back to the box.
// With `client`, the message carries context (#86): the note open in the
// editor and its selection (on its own, no button: × leaves it out of this
// message), and the notes and files mentioned with @ or attached.
export function Composer({ placeholder, busy, onSend, client = null, children }: {
  placeholder: string;
  busy: boolean;
  onSend: (text: string, context: MessageContext | null) => Promise<boolean>;
  client?: ContextClient | null;
  children?: ReactNode;
}) {
  const [text, setText] = useState('');
  const action = useBusy();
  const upload = useBusy();
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // The selection taken off this message: another one shows, and after sending this one does too.
  const [dropped, setDropped] = useState<MessageSelection | null>(null);
  // The @ being typed, at `start` in the text, and what it matches.
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const place = useEditorPlace();
  const withContext = client !== null;
  const selection = withContext && place?.selection != null && place.selection !== dropped ? place.selection : null;
  const blocked = busy || action.busy || upload.busy || text.trim() === '';

  // Where the caret goes once the text changed here (a mention picked, an @
  // put in): set as the new text is committed, before any key that follows.
  const caretTo = useRef<number | null>(null);
  useLayoutEffect(() => {
    const area = box.current;
    if (area === null) return;
    area.style.height = 'auto';
    area.style.height = `${String(area.scrollHeight)}px`;
    if (caretTo.current !== null) {
      area.focus();
      area.setSelectionRange(caretTo.current, caretTo.current);
      caretTo.current = null;
    }
  }, [text]);

  const contextOf = (): MessageContext | null => {
    if (!withContext) return null;
    if (place === null && mentions.length === 0 && attachments.length === 0) return null;
    // A selection too long to carry goes as its lines alone.
    const sent = selection !== null && (selection.source.length > SELECTION_MAX || selection.text.length > SELECTION_MAX) ? { lines: selection.lines, source: '', text: '' } : selection;
    return { note: place?.note ?? null, selection: sent, caret: selection === null ? (place?.caret ?? null) : null, mentions, attachments };
  };

  const send = () => {
    if (blocked) return;
    const message = text;
    const context = contextOf();
    const kept = { mentions, attachments };
    setText('');
    setQuery(null);
    setMentions([]);
    setAttachments([]);
    void action.run(async () => {
      if (await onSend(message, context)) {
        setDropped(null);
        return;
      }
      // What was typed or added meanwhile stays.
      setText((now) => (now === '' ? message : now));
      setMentions((now) => (now.length === 0 ? kept.mentions : now));
      setAttachments((now) => (now.length === 0 ? kept.attachments : now));
    }).finally(() => { box.current?.focus(); });
  };

  const pick = (mention: Mention) => {
    if (query !== null) {
      // The chip names it: the @word goes from the text.
      const end = query.start + 1 + query.text.length;
      caretTo.current = query.start;
      setText((before) => before.slice(0, query.start) + before.slice(end));
    }
    setMentions((before) => (before.some((each) => each.path === mention.path) ? before : [...before, mention]));
    setQuery(null);
    box.current?.focus();
  };

  // Files go up one at a time; one dropped or pasted meanwhile waits its turn.
  const waiting = useRef<File[]>([]);
  const attach = (files: FileList | File[] | null) => {
    if (client === null || files === null) return;
    waiting.current.push(...files);
    void upload.run(async () => {
      for (let each = waiting.current.shift(); each !== undefined; each = waiting.current.shift()) {
        if (each.size > ATTACHMENT_MAX_BYTES) {
          toast.error(`${each.name} is larger than ${String(ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB: attach a smaller document.`);
          continue;
        }
        try {
          const attachment = await client.attach(each);
          setAttachments((before) => [...before, attachment]);
        } catch (reason) {
          // The others still go up.
          toast.error(reason);
        }
      }
    }, 'attach');
  };

  const typed = (value: string, caret: number) => {
    setText(value);
    setQuery(withContext ? mentionAt(value, caret) : null);
  };

  return (
    <form
      className="studio-agent-composer"
      onSubmit={(event) => { event.preventDefault(); send(); }}
      onDragOver={withContext ? (event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); } : undefined}
      onDrop={withContext ? (event) => { if (event.dataTransfer.files.length === 0) return; event.preventDefault(); attach(event.dataTransfer.files); } : undefined}
    >
      {withContext && (place !== null || mentions.length > 0 || attachments.length > 0) && (
        <div className="studio-agent-chips" aria-label="Sent with the message">
          {place !== null && (selection !== null
            ? <SelectionChip note={place.note} selection={selection} onRemove={() => { setDropped(selection); }} />
            : <CaretChip note={place.note} caret={place.caret} />)}
          {mentions.map((mention) => <MentionChip key={mention.path} mention={mention} onRemove={() => { setMentions((before) => before.filter((each) => each !== mention)); }} />)}
          {attachments.map((attachment) => <AttachmentChip key={attachment.id} attachment={attachment} onRemove={() => { setAttachments((before) => before.filter((each) => each !== attachment)); }} />)}
        </div>
      )}
      <textarea
        ref={box}
        id="studio-agent-prompt"
        rows={1}
        aria-label="Message"
        placeholder={placeholder}
        value={text}
        onChange={(event) => { typed(event.target.value, event.target.selectionStart); }}
        onPaste={withContext ? (event) => { if (event.clipboardData.files.length === 0) return; event.preventDefault(); attach(event.clipboardData.files); } : undefined}
        onKeyDown={(event) => {
          // An open list of mentions takes the arrows, Enter and Escape (MentionList).
          if (event.nativeEvent.defaultPrevented) return;
          if (event.key !== 'Enter' || event.shiftKey || composing(event)) return;
          event.preventDefault();
          send();
        }}
      />
      {client !== null && query !== null && (
        <MentionList client={client} query={query.text} input={box} onPick={pick} onClose={() => { setQuery(null); }} />
      )}
      <div className="studio-agent-composer-row">
        {withContext && (
          <>
            <input ref={file} type="file" multiple hidden onChange={(event) => { attach(event.target.files); event.target.value = ''; }} />
            <PendingButton className="studio-agent-composer-tool" aria-label="Attach a document" title={upload.busy ? 'Attaching…' : 'Attach a document'} pending={upload.busy} pendingLabel={null} onClick={() => { file.current?.click(); }}>
              <Paperclip size={14} aria-hidden />
            </PendingButton>
            <button
              type="button"
              className="studio-agent-composer-tool"
              aria-label="Mention a note or file"
              title="Mention a note or file"
              onClick={() => {
                const area = box.current;
                const at = area?.selectionStart ?? text.length;
                const before = text.slice(0, at);
                const insert = before === '' || /\s$/.test(before) ? '@' : ' @';
                caretTo.current = at + insert.length;
                typed(before + insert + text.slice(at), at + insert.length);
              }}
            >
              <AtSign size={14} aria-hidden />
            </button>
          </>
        )}
        {children}
        <span className="flex-1" />
        <PendingButton type="submit" className="studio-agent-send" aria-label="Send" title="Send" pending={action.busy} pendingLabel={null} disabled={blocked}>
          <ArrowUp size={14} aria-hidden />
        </PendingButton>
      </div>
    </form>
  );
}
