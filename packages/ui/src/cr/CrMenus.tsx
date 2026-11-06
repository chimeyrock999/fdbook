import { Check, ChevronDown, Eye, GitBranch, List, Pencil, Plus } from 'lucide-react';
import type { ChangeRequest, CrList, CrStatus } from '#api/crs.ts';
import { isOpen, STATUS_LABELS } from './cr-status';
import { PopupMenu } from './PopupMenu';
import { useMenu } from './use-menu';

export function CrBadge({ status }: { status: CrStatus | 'read-only' }) {
  return (
    <span className="studio-cr-badge" data-status={status}>
      {status === 'read-only' ? 'Read only' : STATUS_LABELS[status]}
    </span>
  );
}

function CrItem({ cr, checked, disabled = false, onPick }: { cr: ChangeRequest; checked?: boolean; disabled?: boolean; onPick: () => void }) {
  return (
    <button type="button" role="menuitem" title={cr.branch} disabled={disabled} onClick={onPick}>
      {checked !== undefined && <span className="studio-menu-check">{checked && <Check size={13} />}</span>}
      <span className="studio-cr-menu-name">{cr.name}</span>
      <CrBadge status={cr.status} />
    </button>
  );
}

// The header's change request picker: main (read only) or the change
// request this page edits, with its status. Its menu switches between them,
// starts a new one or opens the list. Merged and closed change requests are
// in the list only. While the open note has unsaved edits (`waiting`), it
// does not switch: the page load would drop them. Without `onNew` (a
// reader) it offers no new one.
export function CrPicker({ list, current, waiting = false, onSwitch, onNew, onList }: {
  list: CrList | null;
  current: string | null;
  waiting?: boolean;
  onSwitch: (slug: string | null) => void;
  onNew: (() => void) | null;
  onList: () => void;
}) {
  const menu = useMenu();
  const cr = current === null ? null : (list?.crs.find((each) => each.slug === current) ?? null);
  const shown = list?.crs.filter((each) => isOpen(each) || each.slug === current) ?? [];
  const pick = (action: () => void) => () => {
    menu.close();
    action();
  };
  return (
    <>
      <button
        type="button"
        className="studio-cr-picker"
        aria-haspopup="menu"
        aria-expanded={menu.anchor !== null}
        aria-label={current === null ? 'Change request: main, read only' : `Change request: ${cr?.name ?? current}`}
        title={current === null ? 'main' : `cr/${current}`}
        onClick={(event) => { menu.toggle(event.currentTarget); }}
      >
        {current === null ? <Eye size={14} aria-hidden /> : <GitBranch size={14} aria-hidden />}
        <span className="studio-cr-picker-name">{current === null ? 'main' : (cr?.name ?? current)}</span>
        {current === null ? <CrBadge status="read-only" /> : cr && <CrBadge status={cr.status} />}
        <ChevronDown size={14} aria-hidden />
      </button>
      {menu.anchor && (
        <PopupMenu anchor={menu.anchor} label="Change requests" onClose={menu.close}>
          <button type="button" role="menuitem" disabled={waiting && current !== null} onClick={pick(() => { if (current !== null) onSwitch(null); })}>
            <span className="studio-menu-check">{current === null && <Check size={13} />}</span>
            <Eye size={14} aria-hidden />
            <span className="studio-cr-menu-name">main</span>
            <CrBadge status="read-only" />
          </button>
          {shown.length > 0 && <hr />}
          {shown.length > 0 && <p className="studio-menu-hint">Change requests</p>}
          {shown.map((each) => (
            <CrItem key={each.slug} cr={each} checked={each.slug === current} disabled={waiting && each.slug !== current} onPick={pick(() => { if (each.slug !== current) onSwitch(each.slug); })} />
          ))}
          <hr />
          {onNew !== null && (
            <button type="button" role="menuitem" disabled={waiting} onClick={pick(onNew)}>
              <span className="studio-menu-check" />
              <Plus size={14} aria-hidden /> New change request…
            </button>
          )}
          <button type="button" role="menuitem" onClick={pick(onList)}>
            <span className="studio-menu-check" />
            <List size={14} aria-hidden /> All change requests
          </button>
          {waiting && <p className="studio-menu-hint">The open note has unsaved changes. Switch once it shows Saved.</p>}
        </PopupMenu>
      )}
    </>
  );
}

// Edit, on main: continue in a change request that is still open, or start
// a new one. With none open it starts a new one at once.
export function EditMenu({ list, onSwitch, onNew }: { list: CrList | null; onSwitch: (slug: string) => void; onNew: () => void }) {
  const menu = useMenu();
  const open = list?.crs.filter(isOpen) ?? [];
  const pick = (action: () => void) => () => {
    menu.close();
    action();
  };
  return (
    <>
      <button
        type="button"
        className="studio-button studio-button-primary gap-1.5"
        aria-haspopup={open.length > 0 ? 'menu' : 'dialog'}
        aria-expanded={open.length > 0 ? menu.anchor !== null : undefined}
        onClick={(event) => { if (open.length > 0) menu.toggle(event.currentTarget); else onNew(); }}
      >
        <Pencil size={14} aria-hidden />
        Edit
        {open.length > 0 && <ChevronDown size={14} aria-hidden />}
      </button>
      {menu.anchor && (
        <PopupMenu anchor={menu.anchor} label="Edit in a change request" onClose={menu.close}>
          <p className="studio-menu-hint">Continue in a change request</p>
          {open.map((cr) => <CrItem key={cr.slug} cr={cr} onPick={pick(() => { onSwitch(cr.slug); })} />)}
          <hr />
          <button type="button" role="menuitem" onClick={pick(onNew)}>
            <Plus size={14} aria-hidden /> New change request…
          </button>
        </PopupMenu>
      )}
    </>
  );
}
