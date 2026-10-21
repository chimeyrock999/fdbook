import { Check, ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { ChangeRequest, CrList } from '../api/crs';
import { CrBadge } from './CrMenus';
import { GROUPS, plural, updatedAgo } from './cr-status';

function Card({ cr, current, waiting, onOpen, onDiscard }: { cr: ChangeRequest; current: boolean; waiting: boolean; onOpen: () => void; onDiscard: () => void }) {
  return (
    <li className="studio-cr-card" aria-current={current || undefined} aria-label={cr.name}>
      <div className="studio-cr-card-title">
        <strong>{cr.name}</strong>
        <CrBadge status={cr.status} />
        <span className="studio-cr-hint">{cr.branch}</span>
      </div>
      <div className="studio-cr-card-meta">
        <span>
          {plural(cr.changedPages, 'page')} changed
          {cr.uncommitted > 0 && ` · ${String(cr.uncommitted)} not committed`}
        </span>
        <span title={new Date(cr.updatedMs).toLocaleString()}>Updated {updatedAgo(cr.updatedMs)}</span>
        {cr.previewUrl !== null && (
          <a href={cr.previewUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={12} aria-hidden /> Preview
          </a>
        )}
        {cr.pr !== null && (
          <a href={cr.pr.url} target="_blank" rel="noreferrer">
            <ExternalLink size={12} aria-hidden /> PR #{cr.pr.number}
          </a>
        )}
      </div>
      <div className="studio-cr-card-ops">
        {current ? (
          <span className="studio-cr-here">
            <Check size={13} aria-hidden /> Open now
          </span>
        ) : (
          <button type="button" className="studio-button" disabled={waiting} title={waiting ? WAIT_HINT : undefined} onClick={onOpen}>Open</button>
        )}
        <button type="button" className="studio-button gap-1.5" aria-label={`Discard ${cr.name}`} onClick={onDiscard}>
          <Trash2 size={14} aria-hidden /> <span className="max-md:hidden">Discard</span>
        </button>
      </div>
    </li>
  );
}

const WAIT_HINT = 'The open note has unsaved changes. Switch once it shows Saved.';

// Every change request, in the main pane: in progress (Draft, Previewing),
// waiting to merge (In review) and to clean up (Merged, Closed). Opening
// another one (or a new one) waits while the open note has unsaved edits.
export function CrListPage({ list, error, current, waiting = false, onOpen, onNew, onDiscard, onRefresh }: {
  list: CrList | null;
  error: string | null;
  current: string | null;
  waiting?: boolean;
  onOpen: (slug: string) => void;
  onNew: () => void;
  onDiscard: (cr: ChangeRequest) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="studio-cr-list min-h-0 overflow-auto" aria-label="Change requests">
      <div className="studio-cr-list-head">
        <h1>Change requests</h1>
        <button type="button" className="studio-button gap-1.5" onClick={onRefresh} title="Read the branches and pull requests again">
          <RefreshCw size={14} aria-hidden /> <span className="max-md:hidden">Refresh</span>
        </button>
        <button type="button" className="studio-button studio-button-primary gap-1.5" disabled={waiting} title={waiting ? WAIT_HINT : undefined} onClick={onNew}>
          <Plus size={14} aria-hidden /> New change request
        </button>
      </div>
      {error !== null && <p role="alert" className="studio-tree-error">Could not load the change requests: {error}</p>}
      {list?.prError != null && (
        <p role="status" className="studio-cr-warning">Pull requests could not be read ({list.prError}): statuses come from git alone.</p>
      )}
      {list === null && error === null && <p role="status" className="studio-cr-empty">Loading change requests…</p>}
      {list !== null &&
        GROUPS.map((group) => {
          const crs = list.crs.filter((cr) => group.statuses.includes(cr.status));
          return (
            <div key={group.title} className="studio-cr-group">
              <h2>
                {group.title} <span className="studio-cr-count">{crs.length}</span>
              </h2>
              {crs.length === 0 ? (
                <p className="studio-cr-empty">{group.empty}</p>
              ) : (
                <ul className="grid gap-2">
                  {crs.map((cr) => (
                    <Card key={cr.slug} cr={cr} current={cr.slug === current} waiting={waiting} onOpen={() => { onOpen(cr.slug); }} onDiscard={() => { onDiscard(cr); }} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
    </section>
  );
}
