import type { UploadNotice as Notice } from './asset-media';

// The upload in progress, or why the last one failed, beside the save status.
export function UploadNotice({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  if (notice === null) return null;
  if (notice.kind === 'busy') {
    return (
      <span role="status" className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] text-[var(--fde-muted-foreground)]">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--fde-idea)]" />
        <span className="truncate">{notice.text}</span>
      </span>
    );
  }
  return (
    <span role="alert" className="inline-flex min-w-0 items-center gap-1 text-[12.5px] text-[var(--fde-error)]">
      <span className="min-w-0 truncate" title={notice.text}>{notice.text}</span>
      <button type="button" aria-label="Dismiss" className="shrink-0 px-0.5" onClick={onDismiss}>
        ×
      </button>
    </span>
  );
}
