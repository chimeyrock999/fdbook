import { ArrowUp, Check, ExternalLink, GitPullRequest } from 'lucide-react';
import { useShownAfter } from '#actions/busy.ts';
import { Spinner } from '#actions/PendingButton.tsx';
import type { PrimaryAction, PrimaryKind } from './primary-action';

const ICONS: Record<PrimaryKind, typeof Check> = { commit: Check, preview: ArrowUp, update: ArrowUp, publish: GitPullRequest, view: ExternalLink };

// The header's main action (primaryActionOf): View PR is a link, the rest
// are buttons that `onAction` carries out. One whose request is out shows a
// spinner for its icon after a moment, as a PendingButton does. A phone
// shows the icon only, so the header fits (#162); the label stays its name.
export function PrimaryActionButton({ action, onAction }: { action: PrimaryAction; onAction: (kind: PrimaryKind) => void }) {
  const Icon = ICONS[action.kind];
  const shown = useShownAfter(action.pending === true);
  const content = <>{shown ? <Spinner size={14} /> : <Icon size={14} aria-hidden />}<span className="max-md:hidden">{action.label}</span></>;
  if (action.href !== undefined) {
    return <a className="studio-button studio-button-primary gap-1.5 max-md:px-[7px]" href={action.href} target="_blank" rel="noreferrer" aria-label={action.label} title={action.title}>{content}</a>;
  }
  return (
    <button
      type="button"
      className={`studio-button gap-1.5 max-md:px-[7px] ${action.disabled ? '' : 'studio-button-primary'}`}
      disabled={action.disabled}
      aria-label={action.label}
      aria-busy={action.pending === true || undefined}
      title={action.title}
      data-action={action.kind}
      onClick={() => { onAction(action.kind); }}
    >
      {content}
    </button>
  );
}
