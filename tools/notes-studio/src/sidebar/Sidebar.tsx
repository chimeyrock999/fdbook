import { CircleAlert, FolderTree, PanelLeft } from 'lucide-react';
import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_WIDTH, type Sidebar as SidebarState, type SidebarView } from './useSidebar';

// The open note's issue count for the activity bar, or null with no note.
export type IssueCount = { count: number; errors: boolean } | null;

const STEP = 16;
const BIG_STEP = 48;

// The left side of the Studio, as in VS Code: an activity bar with the Notes
// and Issues views and, at its foot, the button that hides the sidebar; then
// the open view, which can be resized from its right edge. Below 768px the
// whole sidebar is a drawer (`drawer`), always showing its view: there the
// view buttons only switch views and the foot button closes the drawer
// (`onCloseDrawer`), leaving the desktop layout as it was. The Issues
// view is filled by the editor through a portal into `issuesRef`, since the
// lint lives with the open note.
export function Sidebar({ state, drawer, onCloseDrawer, issues, notes, issuesRef }: {
  state: SidebarState;
  drawer: boolean;
  onCloseDrawer: () => void;
  issues: IssueCount;
  notes: ReactNode;
  issuesRef: (element: HTMLElement | null) => void;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const shown = state.shown || drawer;

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const left = pane.current?.getBoundingClientRect().left;
    if (left === undefined) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    handle.dataset.dragging = '';
    const move = (next: globalThis.PointerEvent) => { state.resize(next.clientX - left); };
    const stop = () => {
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
    const next = { ArrowLeft: state.width - step, ArrowRight: state.width + step, Home: SIDEBAR_MIN, End: SIDEBAR_MAX }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    state.resize(next);
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
        <button
          type="button"
          className="studio-activity-button studio-activity-bottom"
          aria-pressed={shown}
          aria-label={shown ? 'Hide the sidebar' : 'Show the sidebar'}
          title={shown ? 'Hide the sidebar' : 'Show the sidebar'}
          onClick={drawer ? onCloseDrawer : state.toggle}
        >
          <PanelLeft size={18} strokeWidth={1.8} />
        </button>
      </nav>
      <div ref={pane} className="studio-pane" style={{ width: state.width }} hidden={!shown}>
        <div className="studio-pane-view" hidden={state.view !== 'notes'}>
          {notes}
        </div>
        <div className="studio-pane-view" hidden={state.view !== 'issues'}>
          <h2 className="studio-pane-head">Issues</h2>
          {issues === null && <p className="px-3 py-2 text-[12.5px] text-[var(--fde-muted-foreground)]">Open a note to see its issues.</p>}
          <div ref={issuesRef} className="min-h-0 flex-1 overflow-auto px-3 pt-2 pb-5" />
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the sidebar"
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          aria-valuenow={state.width}
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
