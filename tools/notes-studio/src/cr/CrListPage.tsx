import { ArrowDown, Bot, Brush, Check, Clock, ExternalLink, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { costLabel } from '../agents/transcript';
import type { RunTotals } from '../api/agents';
import type { ChangeRequest, CrList } from '../api/crs';
import { ADMIN_HINT } from '../session/session';
import { CrBadge } from './CrMenus';
import { daysSince, GROUPS, isDone, plural, shortPath, updatedAgo } from './cr-status';

// How far it is from main: behind, or the files a merge of main would conflict in.
function DriftMeta({ cr }: { cr: ChangeRequest }) {
  if (cr.drift === null || cr.drift.conflicts.length > 0) return null;
  return cr.drift.behind === 0 ? (
    <span className="studio-cr-drift"><Check size={12} aria-hidden /> Up to date with main</span>
  ) : (
    <span className="studio-cr-drift"><ArrowDown size={12} aria-hidden /> {plural(cr.drift.behind, 'commit')} behind main</span>
  );
}

// `discard`: whether this person may discard it, or only an admin may (it is on origin), or nobody here (a reader).
type DiscardRight = 'yes' | 'admin' | 'no';

// Its agent runs, and what the agents said they cost.
function AgentMeta({ totals }: { totals: RunTotals }) {
  const costs = Object.entries(totals.costs).flatMap(([currency, amount]) => costLabel({ cost: { amount, currency } }) ?? []);
  return (
    <span className="studio-cr-agents">
      <Bot size={12} aria-hidden /> {plural(totals.runs, 'agent run')} · {costs.length > 0 ? costs.join(' + ') : 'cost not reported'}
    </span>
  );
}

function Card({ cr, current, waiting, discard, agents, onOpen, onDiscard }: {
  cr: ChangeRequest;
  current: boolean;
  waiting: boolean;
  discard: DiscardRight;
  agents: RunTotals | null;
  onOpen: () => void;
  onDiscard: () => void;
}) {
  const blocked = discard === 'admin';
  return (
    <li className="studio-cr-card" aria-current={current || undefined} aria-label={cr.name}>
      <div className="studio-cr-card-title">
        <strong>{cr.name}</strong>
        <CrBadge status={cr.status} />
        {cr.stale && <span className="studio-cr-stale"><Clock size={11} aria-hidden /> Stale</span>}
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
        <DriftMeta cr={cr} />
        {agents !== null && <AgentMeta totals={agents} />}
      </div>
      <div className="studio-cr-card-ops">
        {current ? (
          <span className="studio-cr-here">
            <Check size={13} aria-hidden /> Current
          </span>
        ) : (
          <button type="button" className="studio-button" disabled={waiting} title={waiting ? WAIT_HINT : undefined} onClick={onOpen}>Open</button>
        )}
        {discard === 'no' ? null : isDone(cr) ? (
          <button type="button" className="studio-button studio-button-primary gap-1.5" aria-label={`Clean up ${cr.name}`} disabled={blocked} title={blocked ? ADMIN_HINT : undefined} onClick={onDiscard}>
            <Brush size={14} aria-hidden /> Clean up
          </button>
        ) : (
          <button type="button" className="studio-button gap-1.5" aria-label={`Discard ${cr.name}`} disabled={blocked} title={blocked ? ADMIN_HINT : undefined} onClick={onDiscard}>
            <Trash2 size={14} aria-hidden /> <span className="max-md:hidden">Discard</span>
          </button>
        )}
      </div>
      {cr.drift !== null && cr.drift.conflicts.length > 0 && (
        <p className="studio-cr-alert" data-tone="warning">
          <TriangleAlert size={14} aria-hidden />
          <span>
            Conflicts with main in {plural(cr.drift.conflicts.length, 'file')}: {cr.drift.conflicts.map(shortPath).join(', ')}. {plural(cr.drift.behind, 'commit')} behind main.
          </span>
        </p>
      )}
      {cr.stale && (
        <p className="studio-cr-alert">
          <Clock size={14} aria-hidden />
          <span>Not touched for {plural(daysSince(cr.updatedMs), 'day')}. Discard it if it is no longer needed.</span>
        </p>
      )}
    </li>
  );
}

const WAIT_HINT = 'The open note has unsaved changes. Switch once it shows Saved.';

// Every change request, in the main pane: in progress (Draft, Previewing),
// waiting to merge (In review) and to clean up (Merged, Closed), with how
// far each is from main and whether it went stale. Merged and closed ones
// offer Clean up instead of Discard. Opening another one (or a new one)
// waits while the open note has unsaved edits. Without `onNew` and
// `onDiscard` (a reader) it only lists; `canDiscard` says which ones this
// person may remove (the others need an admin).
export function CrListPage({ list, error, current, waiting = false, agents = {}, onOpen, onNew, onDiscard, canDiscard = () => true, onRefresh }: {
  list: CrList | null;
  // Agent runs and cost by change request.
  agents?: Record<string, RunTotals>;
  error: string | null;
  current: string | null;
  waiting?: boolean;
  onOpen: (slug: string) => void;
  onNew: (() => void) | null;
  onDiscard: ((cr: ChangeRequest) => void) | null;
  canDiscard?: (cr: ChangeRequest) => boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="studio-cr-list min-h-0 overflow-auto" aria-label="Change requests">
      <div className="studio-cr-list-head">
        <h1>Change requests</h1>
        <button type="button" className="studio-button gap-1.5" onClick={onRefresh} title="Fetch origin, then read the branches and pull requests again">
          <RefreshCw size={14} aria-hidden /> <span className="max-md:hidden">Refresh</span>
        </button>
        {onNew !== null && (
          <button type="button" className="studio-button studio-button-primary gap-1.5" disabled={waiting} title={waiting ? WAIT_HINT : undefined} onClick={onNew}>
            <Plus size={14} aria-hidden /> New change request
          </button>
        )}
      </div>
      {error !== null && <p role="alert" className="studio-tree-error">Could not load the change requests: {error}</p>}
      {list?.fetchError != null && (
        <p role="status" className="studio-cr-warning">Could not fetch origin ({list.fetchError}): main and the branches are as last fetched.</p>
      )}
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
                    <Card
                      key={cr.slug}
                      cr={cr}
                      current={cr.slug === current}
                      waiting={waiting}
                      agents={agents[cr.slug] ?? null}
                      discard={onDiscard === null ? 'no' : canDiscard(cr) ? 'yes' : 'admin'}
                      onOpen={() => { onOpen(cr.slug); }}
                      onDiscard={() => { onDiscard?.(cr); }}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
    </section>
  );
}
