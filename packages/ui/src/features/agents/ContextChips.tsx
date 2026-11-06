import { FileCode, FileText, Image, Paperclip, TextSelect, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Attachment, Mention, MessageContext, MessageSelection } from '#api/agents.ts';
import { linesLabel, shortPath } from './context-labels';

const MENTION_ICONS = { note: FileText, asset: Image, file: FileCode } as const;

function Chip({ kind, icon, label, title, onRemove, removeLabel }: { kind: string; icon: ReactNode; label: string; title: string; onRemove?: (() => void) | undefined; removeLabel?: string }) {
  return (
    <span className="studio-agent-chip" data-kind={kind} title={title}>
      {icon}
      <span className="studio-agent-chip-label">{label}</span>
      {onRemove !== undefined && (
        <button type="button" className="studio-agent-chip-remove" aria-label={removeLabel} title={removeLabel} onClick={onRemove}>
          <X size={11} aria-hidden />
        </button>
      )}
    </span>
  );
}

export function SelectionChip({ note, selection, onRemove }: { note: string; selection: MessageSelection; onRemove?: () => void }) {
  const label = `${shortPath(note)}:${linesLabel(selection.lines)}`;
  return <Chip kind="selection" icon={<TextSelect size={12} aria-hidden />} label={label} title={`Selected: ${note}, ${linesLabel(selection.lines)}`} onRemove={onRemove} removeLabel="Leave the selection out of this message" />;
}

// The open note and the caret's line, when nothing is selected: always sent.
export function CaretChip({ note, caret }: { note: string; caret: number | null }) {
  const label = caret === null ? shortPath(note) : `${shortPath(note)}:L${String(caret)}`;
  return <Chip kind="caret" icon={<FileText size={12} aria-hidden />} label={label} title={`Open note: ${note}`} />;
}

export function MentionChip({ mention, onRemove }: { mention: Mention; onRemove?: () => void }) {
  const Icon = MENTION_ICONS[mention.kind];
  return <Chip kind={mention.kind} icon={<Icon size={12} aria-hidden />} label={`@${shortPath(mention.path)}`} title={mention.path} onRemove={onRemove} removeLabel={`Remove ${mention.path}`} />;
}

export function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove?: () => void }) {
  return <Chip kind="attachment" icon={<Paperclip size={12} aria-hidden />} label={attachment.name} title={`Attached: ${attachment.name}`} onRemove={onRemove} removeLabel={`Remove ${attachment.name}`} />;
}

// What went with a message, under it in the thread.
export function ContextChips({ context }: { context: MessageContext }) {
  const { note, selection, caret, mentions, attachments } = context;
  if (note === null && mentions.length === 0 && attachments.length === 0) return null;
  return (
    <span className="studio-agent-chips studio-agent-prompt-context" aria-label="Sent with the message">
      {note !== null && (selection !== null ? <SelectionChip note={note} selection={selection} /> : <CaretChip note={note} caret={caret} />)}
      {mentions.map((mention) => <MentionChip key={mention.path} mention={mention} />)}
      {attachments.map((attachment) => <AttachmentChip key={attachment.id} attachment={attachment} />)}
    </span>
  );
}
