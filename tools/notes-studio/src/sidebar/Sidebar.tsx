import { CircleAlert, FolderTree, GitBranch, GitCommitHorizontal, Images, PanelLeft } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { clampWidth, SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_WIDTH, type Sidebar as SidebarState, type SidebarView } from './useSidebar';

// The open note's issue count for the activity bar, or null with no note.
export type IssueCount = { count: number; errors: boolean } | null;

const STEP = 16;
const BIG_STEP = 48;
// The activity bar, and the room the editor keeps beside the sidebar.
const ACTIVITY_WIDTH = 44;
const EDITOR_MIN = 420;

// The widest the sidebar can be in this window. The stored width is a
// preference: the sidebar shows at most this, and resizing starts from what
// it shows.
function widthCap() {
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, window.innerWidth - ACTIVITY_WIDTH - EDITOR_MIN));
}

function useWidthCap() {
  const [cap, setCap] = useState(widthCap);
  useEffect(() => {
    const onResize = () => { setCap(widthCap()); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); };
  }, []);
  return cap;
}

// The left side of the Studio, as in VS Code: an activity bar with the Notes,
// Assets, Issues and Changes views and, at its foot, the button that hides
// the sidebar; then the open view, which can be resized from its right edge. Below 768px the
// whole sidebar is a drawer (`drawer`), always showing its view: there the
// view buttons only switch views and the foot button closes the drawer
// (`onCloseDrawer`), leaving the desktop layout as it was. The Issues
// view is filled by the editor through a portal into `issuesRef`, since the
// lint lives with the open note. With change requests, `changeRequests`
// adds a button under the views that opens their list in the main pane.
export function Sidebar({ state, drawer, onCloseDrawer, issues, hasNote, notes, assets, issuesRef, changes = null, changeCount = 0, changeRequests = null }: {
  state: SidebarState;
  drawer: boolean;
  onCloseDrawer: () => void;
  issues: IssueCount;
  // Whether a note is open: its count is null until its first lint result.
  hasNote: boolean;
  notes: ReactNode;
  assets: ReactNode;
  issuesRef: (element: HTMLElement | null) => void;
  // The Changes view, with its own heading, and the number of files changed.
  changes?: ReactNode;
  changeCount?: number;
  changeRequests?: { shown: boolean; onOpen: () => void } | null;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const shown = state.shown || drawer;
  const cap = useWidthCap();
  const width = Math.min(state.width, cap);
  const fit = (next: number) => Math.min(cap, clampWidth(next));

  // The drag sets the pane's width directly and saves it once at the end,
  // so moving the pointer neither re-renders the Studio nor writes storage.
  // A press without a move (a click, a double-click's first press) saves
  // nothing, so a capped width does not replace the stored preference.
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const element = pane.current;
    if (event.button !== 0 || !element) return;
    const left = element.getBoundingClientRect().left;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    handle.dataset.dragging = '';
    let dragged: number | null = null;
    const move = (next: globalThis.PointerEvent) => {
      dragged = fit(next.clientX - left);
      element.style.width = `${String(dragged)}px`;
      handle.setAttribute('aria-valuenow', String(dragged));
    };
    const stop = () => {
      if (dragged !== null) state.resize(dragged);
      delete handle.dataset.dragging;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };

  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const next = { ArrowLeft: width - step, ArrowRight: width + step, Home: SIDEBAR_MIN, End: cap }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    state.resize(fit(next));
  };

  const viewButton = (view: SidebarView, label: string, icon: ReactNode, badge?: ReactNode) => (
    <button
      type="button"
      className="studio-activity-button"
      aria-pressed={state.view === view && shown}
      aria-label={label}
      title={label}
      onClick={() => { if (drawer) state.select(view); else state.pick(view); }}
    >
      {icon}
      {badge}
    </button>
  );

  return (
    <aside aria-label="Sidebar" className={`studio-sidebar ${drawer ? 'studio-drawer-open' : ''}`}>
      <nav aria-label="Sidebar views" className="studio-activity">
        {viewButton('notes', 'Notes', <FolderTree size={20} strokeWidth={1.8} />)}
        {viewButton('assets', 'Assets', <Images size={20} strokeWidth={1.8} />)}
        {viewButton(
          'issues',
          issues === null || issues.count === 0 ? 'Issues' : `Issues (${String(issues.count)})`,
          <CircleAlert size={20} strokeWidth={1.8} />,
          issues !== null && issues.count > 0 && (
            <span className="studio-activity-count" data-errors={issues.errors || undefined}>
              {issues.count}
            </span>
          ),
        )}
        {viewButton(
          'changes',
          changeCount === 0 ? 'Changes' : `Changes (${String(changeCount)})`,
          <GitCommitHorizontal size={20} strokeWidth={1.8} />,
          changeCount > 0 && <span className="studio-activity-count" data-info>{changeCount}</span>,
        )}
        {changeRequests && (
          // A page in the main pane, not a view: it sits at the foot and is
          // filled, not railed, while the list is open.
          <button
            type="button"
            className="studio-activity-button studio-activity-page"
            aria-current={changeRequests.shown ? 'page' : undefined}
            aria-label="Change requests"
            title="Change requests"
            onClick={changeRequests.onOpen}
          >
            <GitBranch size={20} strokeWidth={1.8} />
          </button>
        )}
        <button
          type="button"
          className="studio-activity-button studio-activity-bottom"
          aria-label={shown ? 'Hide the sidebar' : 'Show the sidebar'}
          title={shown ? 'Hide the sidebar' : 'Show the sidebar'}
          onClick={drawer ? onCloseDrawer : state.toggle}
        >
          <PanelLeft size={18} strokeWidth={1.8} />
        </button>
      </nav>
      {/* A phone's drawer sizes the view itself (see .studio-pane). */}
      <div ref={pane} className="studio-pane" style={drawer ? undefined : { width }} hidden={!shown}>
        <div className="studio-pane-view" hidden={state.view !== 'notes'}>
          {notes}
        </div>
        <div className="studio-pane-view" hidden={state.view !== 'assets'}>
          <h2 className="studio-pane-head">Assets</h2>
          {assets}
        </div>
        <div className="studio-pane-view" hidden={state.view !== 'issues'}>
          <h2 className="studio-pane-head">Issues</h2>
          {!hasNote && <p className="px-3 py-2 text-[12.5px] text-[var(--fde-muted-foreground)]">Open a note to see its issues.</p>}
          <div ref={issuesRef} className="min-h-0 flex-1 overflow-auto px-3 pt-2 pb-5" />
        </div>
        <div className="studio-pane-view" hidden={state.view !== 'changes'}>
          {changes}
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the sidebar"
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={cap}
          aria-valuenow={width}
          tabIndex={0}
          title="Drag to resize, double-click to reset"
          className="studio-resize"
          onPointerDown={startResize}
          onDoubleClick={() => { state.resize(SIDEBAR_WIDTH); }}
          onKeyDown={resizeByKey}
        />
      </div>
    </aside>
  );
}
