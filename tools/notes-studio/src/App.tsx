import type { DocumentStatus } from '@fumadocs-editor/core/sync';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentControl } from './agents/AgentControl';
import { AgentPanel } from './agents/AgentPanel';
import { AgentWrote } from './agents/AgentWrote';
import { PermissionDialog } from './agents/PermissionDialog';
import { firstAsk } from './agents/transcript';
import { useAgents } from './agents/useAgents';
import { createAgentsClient, type RunTotals } from './api/agents';
import type { AssetAnswer, AssetUsage } from './api/assets';
import { createAssetsClient } from './api/assets';
import { createChangesClient, type ChangedFile } from './api/changes';
import { assetChanged } from './api/asset-versions';
import { createCrClient, type ChangeRequest, type Discard } from './api/crs';
import { createFilesClient } from './api/files';
import { classifyPath } from '../server/security/asset-types';
import { createLintClient } from './api/lint';
import { createPreviewClient, type Preview } from './api/preview';
import { createTreeClient } from './api/tree';
import { CURRENT_CR } from './api/workspace';
import { movedTo } from './assets/asset-changes';
import { AssetPage } from './assets/AssetPage';
import { AssetsView } from './assets/AssetsView';
import { useAssetList } from './assets/useAssetList';
import { ChangesView } from './changes/ChangesView';
import { leaveNotice, leftBehind, rememberLeave } from './changes/leave';
import { LeaveNotice } from './changes/LeaveNotice';
import { titlesOf } from './changes/labels';
import { treeMarks } from './changes/marks';
import { PreviewSection } from './changes/PreviewSection';
import { primaryActionOf, type PrimaryKind } from './changes/primary-action';
import { PrimaryActionButton } from './changes/PrimaryActionButton';
import { PublishDialog } from './changes/PublishDialog';
import { PullRequestSection } from './changes/PullRequestSection';
import { useChanges } from './changes/useChanges';
import { usePreview } from './changes/usePreview';
import { usePush } from './changes/usePush';
import { DiscardDialog, NewCrDialog } from './cr/CrDialogs';
import { CrListPage } from './cr/CrListPage';
import { CrNotice } from './cr/CrNotice';
import { CrPicker, EditMenu } from './cr/CrMenus';
import { useCrs } from './cr/useCrs';
import { DiffPage } from './diff/DiffPage';
import { createHistoryClient } from './api/history';
import { DeletedPagesPage } from './history/DeletedPagesPage';
import { HistoryPage } from './history/HistoryPage';
import { useDeletedPages } from './history/useDeletedPages';
import { NoteEditor, type SourcePlace } from './editor/NoteEditor';
import { ASSETS_PREFIX } from './media/asset-names';
import { useAssets } from './media/useAssets';
import { NoteGate } from './notes/NoteGate';
import { OpenPreview } from './notes/OpenPreview';
import { isList, movedPage, NOTES_PREFIX, pageFromUrl, pageQuery, previewRoute, syncPath, unsavedNote, type Page } from './notes/notes';
import { Sidebar, type IssueCount } from './sidebar/Sidebar';
import { useSidebar, type SidebarView } from './sidebar/useSidebar';
import { rightsOf, useSession } from './session/session';
import { UserMenu } from './session/UserMenu';
import { PageTree } from './tree/PageTree';
import { useTree } from './tree/useTree';

// Below this width the sidebar is a drawer (see .studio-sidebar).
const DRAWER_QUERY = '(max-width: 767px)';

// Whether two pages are one: the same query, a diff's old name included.
const samePage = (a: Page | null, b: Page) => a !== null && pageQuery(a) === pageQuery(b);

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
  const crClient = useMemo(() => createCrClient(), []);
  // A usage picked in the Assets view, to show in its note's Source; any
  // other way of opening a note drops it.
  const [place, setPlace] = useState<(SourcePlace & { note: string }) | null>(null);
  // What the main pane shows: a note (`active`), an asset page (`asset`) or
  // a file's diff against main (`diff`).
  const [page, setPage] = useState(() => pageFromUrl(window.location.search));
  const active = page?.kind === 'note' ? page.path : null;
  const asset = page?.kind === 'asset' ? page.path : null;
  const diff = page?.kind === 'diff' ? page : null;
  const history = page?.kind === 'history' ? page.path : null;
  // The note the page tree marks: the one open, or the one whose history is.
  const treeNote = active ?? (history?.startsWith(NOTES_PREFIX) ? history : null);
  const historyClient = useMemo(() => createHistoryClient(), []);
  // A page is deleted on HEAD by a commit: the list follows the commits.
  const deleted = useDeletedPages(historyClient, git.history);
  const deletedPage = history === null ? undefined : deleted.pages?.find((each) => each.path === history);
  // The open note's autosave state, by path: a rename waits until it is saved.
  const [saved, setSaved] = useState<{ path: string; status: DocumentStatus } | null>(null);
  const unsaved = unsavedNote(active, saved);
  const crs = useCrs(crClient, files, page?.kind === 'crs');
  // With change requests, main is read only until one is opened (`?cr=`); a
  // Studio over one worktree (enabled: false) edits it as it is.
  const crMode = crs.list?.enabled === true;
  // What the signed-in person may do (#99): a reader reads everything, edits nothing.
  const rights = rightsOf(useSession().state.role);
  const onMain = CURRENT_CR === null && crs.list?.enabled !== false;
  const readOnly = onMain || !rights.write;
  const newCr = rights.write ? () => { setCrDialog({ kind: 'new' }); } : null;
  const discardRight = (cr: ChangeRequest) => (!rights.write ? 'no' : rights.discard(cr) ? 'yes' : 'admin');
  const currentCr = crs.list?.crs.find((cr) => cr.slug === CURRENT_CR) ?? null;
  // Agents run in the change request this page edits (#84).
  const agentsClient = useMemo(() => createAgentsClient(), []);
  const agents = useAgents(agentsClient, crMode && CURRENT_CR !== null);
  const liveRuns = agents.runs.filter((run) => run.status === 'running');
  const asking = rights.agents ? firstAsk(liveRuns, agents.events) : null;
  const [agentTotals, setAgentTotals] = useState<Record<string, RunTotals>>({});
  // Pushing and the Cloudflare Pages build, in the worktree being edited (#19).
  const previewClient = useMemo(() => createPreviewClient(), []);
  // A reader follows a change request's preview too, without pushing or publishing.
  const preview = usePreview(previewClient, !onMain);
  const unpushed = useMemo(() => (preview.preview ? new Set(preview.preview.unpushed) : null), [preview.preview]);
  const { set: setPreview } = preview;
  const { reload: reloadChanges } = git;
  const { reload: reloadCrs } = crs;
  const pushed = useCallback((next: Preview) => {
    setPreview(next);
    void reloadChanges();
    void reloadCrs();
  }, [setPreview, reloadChanges, reloadCrs]);
  // One push for the Preview section and the header's main action.
  const pusher = usePush(previewClient, pushed);
  const [publishing, setPublishing] = useState(false);
  const [crDialog, setCrDialog] = useState<{ kind: 'new' } | { kind: 'discard'; cr: ChangeRequest } | null>(null);
  // The change request the last page left with uncommitted files (switchTo).
  const [left, setLeft] = useState(() => leftBehind(CURRENT_CR));
  const dismissLeft = useCallback(() => { setLeft(null); }, []);
  useEffect(() => { rememberLeave(null); }, []);
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

  // The list of change requests shows each one's agent runs, read again
  // with the list and as this page's runs start and end.
  const runCount = agents.runs.length;
  useEffect(() => {
    if (page?.kind !== 'crs' || !crMode) return undefined;
    let current = true;
    agentsClient.totals().then((totals) => { if (current) setAgentTotals(totals); }, () => undefined);
    return () => { current = false; };
  }, [agentsClient, crMode, page?.kind, crs.list, runCount, liveRuns.length]);

  // A drawer left open while the window grows would keep the sidebar shown.
  useEffect(() => {
    const query = window.matchMedia(DRAWER_QUERY);
    const onChange = () => { if (!query.matches) setDrawer(false); };
    query.addEventListener('change', onChange);
    return () => { query.removeEventListener('change', onChange); };
  }, []);

  // An asset or a diagram changed on disk: what shows it loads it again.
  useEffect(() => files.subscribeFileEvents((event) => {
    const shown = event.path.startsWith(ASSETS_PREFIX) || classifyPath(event.path) === 'diagram';
    if (shown && event.type !== 'unlink' && event.mtimeMs !== null) assetChanged(event.path, event.mtimeMs);
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
    if (samePage(page, next)) return;
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
  // A file an agent wrote: its diff against main.
  const openDiff = (path: string) => {
    setPlace(null);
    go({ kind: 'diff', path });
  };
  // The open asset moved with a rename or a replace: follow it without a new history entry.
  const assetChangedBy = (answer: AssetAnswer) => {
    const to = movedTo(answer);
    if (asset === null || to === null || answer.changes[0]?.path !== asset) return;
    const next: Page = { kind: 'asset', path: to };
    window.history.replaceState(null, '', pageQuery(next));
    setPage(next);
  };

  // Another change request, or main, is another page load: every client on
  // a page talks to one worktree (src/api/workspace.ts). What is open stays
  // open. Not while the open note has edits not on disk yet: the load would
  // drop them (the picker and the list wait, as a rename does).
  const switchTo = (cr: string | null, next: Page | null = page) => {
    if (unsaved !== null) return;
    if (cr !== CURRENT_CR) rememberLeave(leaveNotice(git.changes, CURRENT_CR));
    window.location.assign(pageQuery(next, cr));
  };
  const openList = () => {
    setPlace(null);
    go({ kind: 'crs' });
  };
  const discarded = (discard: Discard) => {
    setCrDialog(null);
    // Its edits went with it: nothing to wait for.
    if (discard.slug === CURRENT_CR) window.location.assign(pageQuery({ kind: 'crs' }, null));
    else void crs.reload();
  };

  const placeSeq = useRef(0);
  const openUsage = (usage: AssetUsage) => {
    placeSeq.current += 1;
    setPlace({ note: usage.note, line: usage.line, column: usage.column, length: usage.length, seq: placeSeq.current });
    go({ kind: 'note', path: usage.note });
  };

  // The open note, or the one whose history is shown, moved with a rename:
  // follow it without a new history entry.
  const renamed = (from: string, to: string) => {
    const next = movedPage(page, from, to);
    if (next === null) return;
    window.history.replaceState(null, '', pageQuery(next));
    setPage(next);
  };

  const pagePath = page === null || isList(page) ? null : page.path;
  // A history restore wrote files: what lists them loads again.
  const restored = () => {
    void git.reload();
    deleted.reload();
  };
  // A file is there when the page tree lists the note or the asset list the asset.
  const route = previewRoute(page, (path) => (path.startsWith(NOTES_PREFIX) ? titles.has(path) : assets.includes(path)));
  const committed = async () => {
    await git.reload();
    await preview.reload();
  };
  const published = (next: Preview) => {
    setPublishing(false);
    setPreview(next);
    void git.reload();
    // The list reads pull requests on its own: read them again for In review.
    void crs.reload(true);
  };

  // The header's main action (#20): Commit → Preview → Publish → View PR.
  const action = readOnly ? null : primaryActionOf({ uncommitted: git.changes?.files.length ?? 0, preview: preview.preview, unsaved, busy: pusher.busy });
  const act = (kind: PrimaryKind) => {
    if (kind === 'commit') {
      // The files are picked and the message written in Changes.
      openView('changes');
      requestAnimationFrame(() => { document.getElementById('studio-commit-message')?.focus(); });
    } else if (kind === 'publish') setPublishing(true);
    else if (preview.preview !== null) {
      // A failed push says why in the Preview section.
      void pusher.push(preview.preview).then((ok) => { if (!ok) openView('changes'); });
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-[var(--fde-background)] text-[var(--fde-foreground)]">
      <header className="flex min-w-0 items-center gap-2.5 border-b border-[var(--fde-border)] px-3 py-2">
        <button type="button" className="studio-button md:hidden" onClick={() => { openView('notes'); }}>
          Notes
        </button>
        <span className={`font-semibold whitespace-nowrap ${crMode ? 'max-md:hidden' : ''}`}>Notes Studio</span>
        {crMode && <CrPicker list={crs.list} current={CURRENT_CR} waiting={unsaved !== null} onSwitch={(cr) => { switchTo(cr); }} onNew={newCr} onList={openList} />}
        <span className={`min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--fde-muted-foreground)] ${crMode ? 'max-md:hidden' : ''}`}>{pagePath ?? ''}</span>
        {crMode && CURRENT_CR === null && rights.write && <EditMenu list={crs.list} onSwitch={(cr) => { switchTo(cr); }} onNew={() => { setCrDialog({ kind: 'new' }); }} />}
        {!onMain && <OpenPreview preview={preview.preview} route={route} />}
        {crMode && <AgentControl agents={agents} live={liveRuns.length} />}
        {action !== null && <PrimaryActionButton action={action} onAction={act} />}
        <UserMenu />
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
              readOnly={readOnly}
              notice={currentCr !== null && <CrNotice cr={currentCr} cleanUp={discardRight(currentCr)} onCleanUp={() => { setCrDialog({ kind: 'discard', cr: currentCr }); }} />}
              onCommitted={committed}
              unpushed={readOnly ? null : unpushed}
              preview={
                readOnly ? null : (
                  <>
                    <PreviewSection pusher={pusher} preview={preview.preview} error={preview.error} unsaved={unsaved} route={route} />
                    <PullRequestSection preview={preview.preview} unsaved={unsaved} busy={pusher.busy} onPublish={() => { setPublishing(true); }} />
                  </>
                )
              }
            />
          }
          changeRequests={crMode ? { shown: page?.kind === 'crs', onOpen: openList } : null}
          deletedPages={{ shown: page?.kind === 'deleted' || deletedPage !== undefined, count: deleted.pages?.length ?? null, onOpen: () => { go({ kind: 'deleted' }); } }}
          assets={
            <AssetsView
              client={assetsClient}
              list={assetList}
              active={active}
              current={asset}
              unsaved={unsaved !== null}
              readOnly={readOnly}
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
                active={treeNote === null ? null : syncPath(treeNote)}
                onOpen={(path) => { open(NOTES_PREFIX + path); }}
                onRenamed={renamed}
                unsaved={unsaved}
                marks={marks}
                readOnly={readOnly}
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
              onShowHistory={() => { go({ kind: 'history', path: active }); }}
              place={place?.note === active ? place : null}
            />
          </NoteGate>
        ) : asset ? (
          <AssetPage
            client={assetsClient}
            list={assetList}
            path={asset}
            unsaved={unsaved !== null}
            readOnly={readOnly}
            onOpenUsage={openUsage}
            onChanged={assetChangedBy}
            onShowHistory={() => { go({ kind: 'history', path: asset }); }}
          />
        ) : diff ? (
          <DiffPage
            client={changesClient}
            target={diff}
            revision={git.changes}
            titles={titles}
            onOpen={(path) => { if (path.startsWith(NOTES_PREFIX)) open(path); else openAsset(path); }}
            onBack={() => { openView('changes'); }}
          />
        ) : history ? (
          <HistoryPage
            client={historyClient}
            path={history}
            title={titles.get(history) ?? deletedPage?.title ?? history.slice(history.lastIndexOf('/') + 1)}
            readOnly={onMain}
            reader={!rights.write}
            revision={git.changes}
            onOpen={() => { if (history.startsWith(NOTES_PREFIX)) open(history); else openAsset(history); }}
            onRestored={(path) => {
              restored();
              // An asset restored under another extension: its history follows it.
              if (path === history) return;
              const next: Page = { kind: 'history', path };
              window.history.replaceState(null, '', pageQuery(next));
              setPage(next);
            }}
            onBroughtBack={(path) => {
              restored();
              void reload();
              open(path);
            }}
            onDeletedList={() => { go({ kind: 'deleted' }); }}
          />
        ) : page?.kind === 'deleted' ? (
          <DeletedPagesPage pages={deleted.pages} error={deleted.error} readOnly={onMain} onOpen={(path) => { go({ kind: 'history', path }); }} />
        ) : page?.kind === 'crs' && crMode ? (
          <CrListPage
            list={crs.list}
            error={crs.error}
            current={CURRENT_CR}
            waiting={unsaved !== null}
            onOpen={(cr) => { switchTo(cr, null); }}
            onNew={newCr}
            onDiscard={rights.write ? (cr) => { setCrDialog({ kind: 'discard', cr }); } : null}
            canDiscard={rights.discard}
            onRefresh={() => { void crs.reload(true); }}
            agents={agentTotals}
          />
        ) : (
          <p className="m-auto p-6 text-[13px] text-[var(--fde-muted-foreground)]">{readOnly ? 'Pick a note to read.' : 'Pick a note to edit.'}</p>
        )}
        {active !== null && <AgentWrote runs={liveRuns} path={active} onOpenDiff={() => { openDiff(active); }} />}
        {crMode && agents.open && <AgentPanel agents={agents} inCr={CURRENT_CR !== null} canRun={rights.agents} onOpenDiff={openDiff} />}
        {left && <LeaveNotice notice={left} onBack={() => { switchTo(left.cr); }} onClose={dismissLeft} />}
      </div>
      {crDialog?.kind === 'new' && (
        <NewCrDialog
          client={crClient}
          taken={crs.list?.taken ?? []}
          onCreated={(cr) => { switchTo(cr.slug); }}
          onClose={() => { setCrDialog(null); }}
        />
      )}
      {publishing && preview.preview !== null && (
        <PublishDialog client={previewClient} preview={preview.preview} onPublished={published} onClose={() => { setPublishing(false); }} />
      )}
      {asking !== null && (
        <PermissionDialog key={asking.ask.id} run={asking.run} ask={asking.ask} at={asking.at} onAnswer={(optionId) => { void agents.answer(asking.run.id, asking.ask.id, optionId); }} />
      )}
      {crDialog?.kind === 'discard' && <DiscardDialog client={crClient} cr={crDialog.cr} current={crDialog.cr.slug === CURRENT_CR} onDone={discarded} onClose={() => { setCrDialog(null); }} />}
    </div>
  );
}
