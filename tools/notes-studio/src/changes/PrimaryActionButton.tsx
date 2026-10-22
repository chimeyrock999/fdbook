import { ArrowUp, Check, ExternalLink, GitPullRequest } from 'lucide-react';
import type { PrimaryAction, PrimaryKind } from './primary-action';

const ICONS: Record<PrimaryKind, typeof Check> = { commit: Check, preview: ArrowUp, update: ArrowUp, publish: GitPullRequest, view: ExternalLink };

// The header's main action (primaryActionOf): View PR is a link, the rest
// are buttons that `onAction` carries out.
export function PrimaryActionButton({ action, onAction }: { action: PrimaryAction; onAction: (kind: PrimaryKind) => void }) {
  const Icon = ICONS[action.kind];
  const content = <><Icon size={14} aria-hidden />{action.label}</>;
  if (action.href !== undefined) {
    return <a className="studio-button studio-button-primary gap-1.5" href={action.href} target="_blank" rel="noreferrer" title={action.title}>{content}</a>;
  }
  return (
    <button
      type="button"
      className={`studio-button gap-1.5 ${action.disabled ? '' : 'studio-button-primary'}`}
      disabled={action.disabled}
      title={action.title}
      data-action={action.kind}
      onClick={() => { onAction(action.kind); }}
    >
      {content}
    </button>
  );
}
