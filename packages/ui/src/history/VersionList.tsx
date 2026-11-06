import type { DeletedIn, PageVersion } from '#api/history.ts';
import { NOW } from '#api/history.ts';
import { timeAgo } from '#changes/labels.ts';
import { fileNameOf, shortVersion } from './versions';

function Tags({ version }: { version: PageVersion }) {
  return (
    <span className="studio-history-tags">
      {version.inChangeRequest && <span className="studio-history-tag" data-tag="cr">In this CR</span>}
      {version.from !== undefined && <span className="studio-history-tag" data-tag="renamed" title={version.from}>Renamed from {fileNameOf(version.from)}</span>}
      {version.status === 'A' && <span className="studio-history-tag" data-tag="created">Created</span>}
    </span>
  );
}

// The page's versions, newest first, on a rail: the commit that deleted it
// when it is gone (not a version: nothing to pick), Now when `ids` starts
// with it, then the commits. `selected` is the one shown.
export function VersionList({ ids, versions, deleted = null, selected, restored, onSelect }: {
  ids: readonly string[];
  versions: readonly PageVersion[];
  deleted?: DeletedIn | null;
  selected: string | null;
  restored: string | null;
  onSelect: (version: string) => void;
}) {
  const bySha = new Map(versions.map((version) => [version.sha, version]));
  return (
    <ol className="studio-history-list">
      {deleted !== null && (
        <li>
          <div className="studio-history-version" data-gone="">
            <span className="studio-history-rail" aria-hidden />
            <span className="studio-history-message">Deleted in {shortVersion(deleted.sha)}</span>
            <span className="studio-history-sub">
              <time dateTime={deleted.date} title={new Date(deleted.date).toLocaleString()}>{timeAgo(deleted.date)}</time>
              <span className="truncate">{deleted.message}</span>
            </span>
            <span className="studio-history-tags"><span className="studio-history-tag" data-tag="deleted">Deleted</span></span>
          </div>
        </li>
      )}
      {ids.map((id) => {
        const version = bySha.get(id);
        return (
          <li key={id}>
            <button
              type="button"
              className="studio-history-version"
              aria-current={id === selected || undefined}
              data-own={id === NOW || version?.inChangeRequest ? '' : undefined}
              data-now={id === NOW ? '' : undefined}
              onClick={() => { onSelect(id); }}
            >
              <span className="studio-history-rail" aria-hidden />
              {version === undefined ? (
                <>
                  <span className="studio-history-message">{restored === null ? 'Now' : `Restored to ${shortVersion(restored)}, not committed`}</span>
                  <span className="studio-history-sub">On disk, committed or not</span>
                </>
              ) : (
                <>
                  <span className="studio-history-message">{version.message}</span>
                  <span className="studio-history-sub">
                    <span className="font-mono">{shortVersion(version.sha)}</span>
                    <time dateTime={version.date} title={new Date(version.date).toLocaleString()}>{timeAgo(version.date)}</time>
                    <span className="truncate">{version.author}</span>
                  </span>
                  <Tags version={version} />
                </>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
