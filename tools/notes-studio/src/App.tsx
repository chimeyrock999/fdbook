import type { DocumentStatus } from '@fumadocs-editor/core/sync';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssetAnswer, AssetUsage } from './api/assets';
import { createAssetsClient } from './api/assets';
import { createChangesClient, type ChangedFile } from './api/changes';
import { assetChanged } from './api/asset-versions';
import { createFilesClient } from './api/files';
import { createLintClient } from './api/lint';
import { createTreeClient } from './api/tree';
import { movedTo } from './assets/asset-changes';
import { AssetPage } from './assets/AssetPage';
import { AssetsView } from './assets/AssetsView';
import { useAssetList } from './assets/useAssetList';
import { ChangesView } from './changes/ChangesView';
import { titlesOf } from './changes/labels';
import { treeMarks } from './changes/marks';
import { useChanges } from './changes/useChanges';
import { DiffPage } from './diff/DiffPage';
import { NoteEditor, type SourcePlace } from './editor/NoteEditor';
import { ASSETS_PREFIX } from './media/asset-names';
import { useAssets } from './media/useAssets';
import { NoteGate } from './notes/NoteGate';
import { OpenOnSite } from './notes/OpenOnSite';
import { NOTES_PREFIX, pageFromUrl, pageQuery, syncPath, unsavedNote, type Page } from './notes/notes';
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
  const changesClient = useMemo(() => createChangesClient(), []);
  const git = useChanges(changesClient, files);
  const marks = useMemo(() => (git.changes ? treeMarks(git.changes.files) : null), [git.changes]);
  const titles = useMemo(() => titlesOf(tree), [tree]);
  // A usage picked in the Assets view, to show in its note's Source; any
  // other way of opening a note drops it.
  const [place, setPlace] = useState<(SourcePlace & { note: string }) | null>(null);
  // What the main pane shows: a note (`active`), an asset page (`asset`) or
  // a file's diff against main (`diff`).
  const [page, setPage] = useState(() => pageFromUrl(window.location.search));
  const active = page?.kind === 'note' ? page.path : null;
  const asset = page?.kind === 'asset' ? page.path : null;
  const diff = page?.kind === 'diff' ? page : null;
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
  // The assets list follows the disk only while the Assets view or an asset page is shown.
  const assetList = useAssetList(assetsClient, files, (sidebar.view === 'assets' && (sidebar.shown || drawer)) || asset !== null);
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

  // An asset changed on disk: what shows it loads it again.
  useEffect(() => files.subscribeFileEvents((event) => {
    if (event.path.startsWith(ASSETS_PREFIX) && event.type !== 'unlink' && event.mtimeMs !== null) assetChanged(event.path, event.mtimeMs);
  }), [files]);

  // Back and forward move between opened notes and assets.
  useEffect(() => {
    const onPop = () => {
      setPlace(null);
      setPage(pageFromUrl(window.location.search));
    };
    window.addEventListener('popstate', onPop);
    return () => { window.removeEventListener('popstate', onPop); };
  }, []);

  const go = (next: Page) => {
    setDrawer(false);
    if (page !== null && pageQuery(next) === pageQuery(page)) return;
    window.history.pushState(null, '', pageQuery(next));
    setPage(next);
  };
  const open = (path: string) => {
    setPlace(null);
    go({ kind: 'note', path });
  };
  const openAsset = (path: string) => {
    setPlace(null);
    go({ kind: 'asset', path });
  };
  // A changed file picked in the Changes view: its diff against main.
  const openChanged = (file: ChangedFile) => {
    setPlace(null);
    go(file.from === undefined ? { kind: 'diff', path: file.path } : { kind: 'diff', path: file.path, from: file.from });
  };
  // The open asset moved with a rename or a replace: follow it without a new history entry.
  const assetChangedBy = (answer: AssetAnswer) => {
    const to = movedTo(answer);
    if (asset === null || to === null || answer.changes[0]?.path !== asset) return;
    const next: Page = { kind: 'asset', path: to };
    window.history.replaceState(null, '', pageQuery(next));
    setPage(next);
  };

  const placeSeq = useRef(0);
  const openUsage = (usage: AssetUsage) => {
    placeSeq.current += 1;
    setPlace({ note: usage.note, line: usage.line, column: usage.column, length: usage.length, seq: placeSeq.current });
    go({ kind: 'note', path: usage.note });
  };

  // The open note moved with a rename: follow it without a new history entry.
  const renamed = (from: string, to: string) => {
    if (active === null) return;
    const moved = renamedPath(syncPath(active), from, to);
    if (moved === null) return;
    const next: Page = { kind: 'note', path: NOTES_PREFIX + moved };
    window.history.replaceState(null, '', pageQuery(next));
    setPage(next);
  };

  return (
    <div className="flex h-dvh flex-col bg-[var(--fde-background)] text-[var(--fde-foreground)]">
      <header className="flex min-w-0 items-center gap-2.5 border-b border-[var(--fde-border)] px-3 py-2">
        <button type="button" className="studio-button md:hidden" onClick={() => { openView('notes'); }}>
          Notes
        </button>
        <span className="font-semibold whitespace-nowrap">Notes Studio</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--fde-muted-foreground)]">{page?.path ?? ''}</span>
        {page && page.kind !== 'diff' && <OpenOnSite path={page.path} />}
      </header>
      <div className="relative flex min-h-0 flex-1">
        <Sidebar
          state={sidebar}
          drawer={drawer}
          onCloseDrawer={closeDrawer}
          issues={issueCount}
          hasNote={active !== null}
          issuesRef={setIssuesSlot}
          changeCount={git.changes?.files.length ?? 0}
          changes={
            <ChangesView
              client={changesClient}
              changes={git.changes}
              history={git.history}
              error={git.error}
              titles={titles}
              unsaved={unsaved}
              current={diff?.path ?? null}
              onOpen={openChanged}
              onCommitted={git.reload}
            />
          }
          assets={
            <AssetsView
              client={assetsClient}
              list={assetList}
              active={active}
              current={asset}
              unsaved={unsaved !== null}
              onOpen={openAsset}
              onOpenUsage={openUsage}
              onChanged={assetChangedBy}
            />
          }
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
                marks={marks}
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
        ) : asset ? (
          <AssetPage client={assetsClient} list={assetList} path={asset} unsaved={unsaved !== null} onOpenUsage={openUsage} onChanged={assetChangedBy} />
        ) : diff ? (
          <DiffPage
            client={changesClient}
            target={diff}
            revision={git.changes}
            titles={titles}
            onOpen={(path) => { if (path.startsWith(NOTES_PREFIX)) open(path); else openAsset(path); }}
            onBack={() => { openView('changes'); }}
          />
        ) : (
          <p className="m-auto p-6 text-[13px] text-[var(--fde-muted-foreground)]">Pick a note to edit.</p>
        )}
      </div>
    </div>
  );
}
