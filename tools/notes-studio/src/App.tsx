import type { DocumentStatus } from '@fumadocs-editor/core/sync';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AssetUsage } from './api/assets';
import { createAssetsClient } from './api/assets';
import { createFilesClient } from './api/files';
import { createLintClient } from './api/lint';
import { createTreeClient } from './api/tree';
import { AssetsView } from './assets/AssetsView';
import { useAssetList } from './assets/useAssetList';
import { NoteEditor, type SourcePlace } from './editor/NoteEditor';
import { useAssets } from './media/useAssets';
import { NoteGate } from './notes/NoteGate';
import { OpenOnSite } from './notes/OpenOnSite';
import { NOTES_PREFIX, noteFromUrl, syncPath, unsavedNote } from './notes/notes';
import { Sidebar, type IssueCount } from './sidebar/Sidebar';
import { useSidebar, type SidebarView } from './sidebar/useSidebar';
import { PageTree } from './tree/PageTree';
import { renamedPath } from './tree/tree';
import { useTree } from './tree/useTree';

// Below this width the sidebar is a drawer (see .studio-sidebar).
const DRAWER_QUERY = '(max-width: 767px)';

export function App() {
  const files = useMemo(() => createFilesClient(), []);
  const lint = useMemo(() => createLintClient(), []);
  const treeClient = useMemo(() => createTreeClient(), []);
  const { tree, error, reload } = useTree(treeClient, files);
  const assets = useAssets(files);
  const assetsClient = useMemo(() => createAssetsClient(), []);
  const assetList = useAssetList(assetsClient, files);
  // A usage picked in the Assets view, to show in its note's Source.
  const [place, setPlace] = useState<(SourcePlace & { note: string }) | null>(null);
  const [active, setActive] = useState(() => noteFromUrl(window.location.search));
  // The open note's autosave state, by path: a rename waits until it is saved.
  const [saved, setSaved] = useState<{ path: string; status: DocumentStatus } | null>(null);
  const unsaved = unsavedNote(active, saved);
  const sidebar = useSidebar();
  // Below 768px the sidebar is a drawer, open or not.
  const [drawer, setDrawer] = useState(false);
  const [issuesSlot, setIssuesSlot] = useState<HTMLElement | null>(null);
  const [issueCount, setIssueCount] = useState<IssueCount>(null);
  const closeDrawer = useCallback(() => { setDrawer(false); }, []);
  const { show, select } = sidebar;
  // On a phone the drawer opens on the view, leaving the desktop layout as it
  // was; on a desktop the sidebar shows the view.
  const openView = useCallback((view: SidebarView) => {
    if (window.matchMedia(DRAWER_QUERY).matches) {
      select(view);
      setDrawer(true);
    } else show(view);
  }, [select, show]);
  const showIssues = useCallback(() => { openView('issues'); }, [openView]);

  // A drawer left open while the window grows would keep the sidebar shown.
  useEffect(() => {
    const query = window.matchMedia(DRAWER_QUERY);
    const onChange = () => { if (!query.matches) setDrawer(false); };
    query.addEventListener('change', onChange);
    return () => { query.removeEventListener('change', onChange); };
  }, []);

  // Back and forward move between opened notes.
  useEffect(() => {
    const onPop = () => { setActive(noteFromUrl(window.location.search)); };
    window.addEventListener('popstate', onPop);
    return () => { window.removeEventListener('popstate', onPop); };
  }, []);

  const open = (path: string) => {
    setDrawer(false);
    if (path === active) return;
    window.history.pushState(null, '', `?path=${encodeURIComponent(path)}`);
    setActive(path);
  };

  const openUsage = (usage: AssetUsage) => {
    setPlace((previous) => ({ note: usage.note, line: usage.line, column: usage.column, length: usage.length, seq: (previous?.seq ?? 0) + 1 }));
    open(usage.note);
  };

  // The open note moved with a rename: follow it without a new history entry.
  const renamed = (from: string, to: string) => {
    if (active === null) return;
    const moved = renamedPath(syncPath(active), from, to);
    if (moved === null) return;
    const path = NOTES_PREFIX + moved;
    window.history.replaceState(null, '', `?path=${encodeURIComponent(path)}`);
    setActive(path);
  };

  return (
    <div className="flex h-dvh flex-col bg-[var(--fde-background)] text-[var(--fde-foreground)]">
      <header className="flex min-w-0 items-center gap-2.5 border-b border-[var(--fde-border)] px-3 py-2">
        <button type="button" className="studio-button md:hidden" onClick={() => { openView('notes'); }}>
          Notes
        </button>
        <span className="font-semibold whitespace-nowrap">Notes Studio</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--fde-muted-foreground)]">{active ?? ''}</span>
        {active && <OpenOnSite path={active} />}
      </header>
      <div className="relative flex min-h-0 flex-1">
        <Sidebar
          state={sidebar}
          drawer={drawer}
          onCloseDrawer={closeDrawer}
          issues={issueCount}
          hasNote={active !== null}
          issuesRef={setIssuesSlot}
          assets={<AssetsView client={assetsClient} list={assetList} active={active} unsaved={unsaved !== null} onOpenUsage={openUsage} />}
          notes={
            <>
              {error && <p role="alert" className="p-3 text-[12.5px] text-[var(--fde-error)]">Could not load the page tree: {error}</p>}
              <PageTree
                root={tree}
                client={treeClient}
                active={active === null ? null : syncPath(active)}
                onOpen={(path) => { open(NOTES_PREFIX + path); }}
                onRenamed={renamed}
                unsaved={unsaved}
                onChanged={reload}
              />
            </>
          }
        />
        {drawer && <button type="button" aria-label="Close the sidebar" className="studio-scrim md:hidden" onClick={closeDrawer} />}
        {active ? (
          <NoteGate files={files} path={active}>
            <NoteEditor
              key={active}
              path={syncPath(active)}
              onStatus={(status) => { setSaved({ path: active, status }); }}
              files={files}
              assets={assets}
              lint={lint}
              issuesSlot={issuesSlot}
              onIssueCount={setIssueCount}
              onShowIssues={showIssues}
              onIssueShown={closeDrawer}
              place={place?.note === active ? place : null}
            />
          </NoteGate>
        ) : (
          <p className="m-auto p-6 text-[13px] text-[var(--fde-muted-foreground)]">Pick a note to edit.</p>
        )}
      </div>
    </div>
  );
}
