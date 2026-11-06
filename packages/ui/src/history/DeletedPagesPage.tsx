import { useState } from 'react';
import type { DeletedPage } from '#api/history.ts';
import { timeAgo } from '#changes/labels.ts';
import { groupDeleted, shortVersion } from './versions';
import { NOTES_DIR } from '@fdbook/shared/asset-types.ts';

const matches = (page: DeletedPage, query: string) => {
  const words = query.trim().toLowerCase();
  return words === '' || page.title.toLowerCase().includes(words) || page.path.toLowerCase().includes(words);
};

// The pages deleted on HEAD (#114), in the main pane: those deleted but
// not committed yet first, then grouped by the commit that deleted them,
// newest first. Opening one shows its history, where a
// version of it can be restored. `pages` is null while they load.
export function DeletedPagesPage({ pages, error, readOnly, onOpen }: {
  pages: DeletedPage[] | null;
  error: string | null;
  readOnly: boolean;
  onOpen: (path: string) => void;
}) {
  const [query, setQuery] = useState('');
  const shown = pages === null ? [] : groupDeleted(pages.filter((page) => matches(page, query)));
  return (
    <section className="studio-history-page" aria-label="Deleted pages">
      <div className="studio-asset-page-bar">
        <div className="studio-asset-page-title">
          <h1 className="flex min-w-0 items-center gap-2">
            <span className="studio-diff-name truncate">Deleted pages</span>
            {pages !== null && <span className="studio-history-chip">{pages.length}</span>}
          </h1>
          <span>{NOTES_DIR}, deleted on {readOnly ? 'main' : 'this change request'}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="studio-deleted-list">
          <p className="text-[13px] text-[var(--fde-muted-foreground)]">
            Pages deleted, newest first; those not committed yet come first. Open one to see its versions{readOnly ? '; restoring one needs a change request.' : ' and restore one into this change request.'}
          </p>
          {error !== null && <p role="alert" className="studio-diff-note studio-changes-error">Could not load the deleted pages: {error}</p>}
          {pages === null ? (
            error === null && <p className="studio-diff-note">Loading the deleted pages…</p>
          ) : pages.length === 0 ? (
            <p className="studio-diff-note">No page was deleted.</p>
          ) : (
            <>
              <input
                type="search"
                aria-label="Filter deleted pages"
                placeholder="Filter by title or path"
                className="studio-input"
                value={query}
                onChange={(event) => { setQuery(event.target.value); }}
              />
              {shown.length === 0 && <p className="studio-diff-note">No deleted page matches “{query}”.</p>}
              {shown.map((group) => (
                <div key={group.committed ? group.sha : 'uncommitted'} className="studio-deleted-group">
                  {group.committed ? (
                    <p className="studio-deleted-head">
                      <b className="font-mono text-[var(--fde-primary)]">{shortVersion(group.sha)}</b>
                      <span className="font-semibold">{group.message}</span>
                      <time dateTime={group.date} title={new Date(group.date).toLocaleString()}>{group.author} · {timeAgo(group.date)}</time>
                    </p>
                  ) : (
                    <p className="studio-deleted-head">
                      <span className="studio-history-tag" data-tag="uncommitted">Not committed</span>
                      <span className="font-semibold">Deleted in this change request</span>
                    </p>
                  )}
                  {group.pages.map((page) => (
                    <button key={page.path} type="button" className="studio-deleted-row" onClick={() => { onOpen(page.path); }}>
                      <span className="truncate text-[13.5px] font-medium">{page.title}</span>
                      <span className="truncate font-mono text-[11.5px] text-[var(--fde-muted-foreground)]">{page.path}</span>
                      {page.folderGone && <span className="studio-history-tag" data-tag="deleted">Folder deleted</span>}
                    </button>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
