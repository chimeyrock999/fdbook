import { ExternalLink, GitPullRequest } from 'lucide-react';
import type { CrStatus } from '#api/crs.ts';
import type { Preview, PullRequestState } from '#api/preview.ts';
import { plural } from '#assets/asset-changes.ts';
import { STATUS_LABELS } from '#cr/cr-status.ts';

// A pull request's state as the change request's status, so its chip reads
// and looks like the change request badges.
const STATUS_OF: Record<PullRequestState, CrStatus> = { OPEN: 'review', MERGED: 'merged', CLOSED: 'closed' };

// The Pull request section of the Changes view (#20), under Preview: Publish
// while the branch has none, then the pull request and its state. A merged
// or closed one is cleaned up with the change request (#21), not published
// again. `busy`: a push or a publish is running.
export function PullRequestSection({ preview, unsaved, busy, onPublish }: {
  preview: Preview | null;
  unsaved: string | null;
  busy: boolean;
  onPublish: () => void;
}) {
  if (preview?.blocked !== null) return null;
  const { pr, prError } = preview;
  const count = preview.unpushed.length;
  const chip = pr === null
    ? <span className="studio-cr-badge" data-testid="pr-state">No pull request</span>
    : <span className="studio-cr-badge" data-status={STATUS_OF[pr.state]} data-testid="pr-state">{STATUS_LABELS[STATUS_OF[pr.state]]}</span>;

  let body;
  if (pr !== null) {
    body = (
      <>
        <div className="studio-pr-title">
          <a href={pr.url} target="_blank" rel="noreferrer">{pr.title}</a>
          <small>#{pr.number} · {preview.branch} → main</small>
        </div>
        <div className="studio-preview-actions">
          <a className="studio-button gap-1.5" href={pr.url} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden />View on GitHub</a>
        </div>
        {pr.state !== 'OPEN' && (
          <p className="studio-changes-why">This pull request is {STATUS_LABELS[STATUS_OF[pr.state]].toLowerCase()}. Clean it up from the notice above.</p>
        )}
      </>
    );
  } else {
    const nothing = preview.pushed === null && count === 0;
    const why = prError !== null ? null : nothing ? 'Commit a change to publish it.' : unsaved !== null ? `Saving ${unsaved}…` : null;
    body = (
      <>
        {prError === null ? (
          <p className="studio-preview-note" data-tone="quiet">
            Publish opens a pull request to main for review.{count > 0 && ` It pushes ${plural(count, 'commit')} first.`}
          </p>
        ) : (
          <p className="studio-preview-note" data-tone="quiet">Could not read the pull request ({prError}). Preview still works.</p>
        )}
        <div className="studio-preview-actions">
          <button
            type="button"
            className={`studio-button gap-1.5 ${count === 0 && !nothing && prError === null ? 'studio-button-primary' : ''}`}
            disabled={nothing || prError !== null || unsaved !== null || busy}
            onClick={onPublish}
          >
            <GitPullRequest size={14} aria-hidden />Publish…
          </button>
        </div>
        {why !== null && <p role="status" className="studio-changes-why">{why}</p>}
      </>
    );
  }
  return (
    <section className="studio-preview" aria-label="Pull request">
      <div className="studio-changes-group studio-preview-head">Pull request {chip}</div>
      <div className="studio-preview-body">{body}</div>
    </section>
  );
}
