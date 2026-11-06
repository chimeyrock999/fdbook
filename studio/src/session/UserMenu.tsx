import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { PopupMenu } from '../cr/PopupMenu';
import { useMenu } from '../cr/use-menu';
import { ROLE_LABELS, useSession } from './session';

// The signed-in person at the end of the header: their picture and login
// (the picture alone on a phone), and a menu with their role and Sign out.
export function UserMenu() {
  const { state, signOut } = useSession();
  const menu = useMenu();
  const [broken, setBroken] = useState(false);
  const { user, role } = state;
  if (user === null || role === null) return null;
  const initials = (user.name ?? user.login).split(/\s+/).map((word) => word.charAt(0)).join('').slice(0, 2).toUpperCase();
  return (
    <>
      <button
        type="button"
        className="studio-user-chip"
        aria-haspopup="menu"
        aria-expanded={menu.anchor !== null}
        aria-label={`Signed in as ${user.login}`}
        onClick={(event) => { menu.toggle(event.currentTarget); }}
      >
        {broken ? (
          <span className="studio-user-avatar" aria-hidden>{initials}</span>
        ) : (
          <img className="studio-user-avatar" src={user.avatarUrl} alt="" onError={() => { setBroken(true); }} />
        )}
        <span className="max-md:hidden">{user.login}</span>
      </button>
      {menu.anchor && (
        <PopupMenu anchor={menu.anchor} label="Account" onClose={menu.close}>
          <div className="studio-user-who">
            <b>{user.name ?? user.login}</b>
            <span>@{user.login}</span>
            <span>
              <span className="studio-role-badge" data-role={role}>{ROLE_LABELS[role]}</span>
              {state.repo !== null && <> on {state.repo}</>}
            </span>
          </div>
          <hr />
          <button type="button" role="menuitem" onClick={() => { menu.close(); signOut(); }}>
            <LogOut size={14} aria-hidden /> Sign out
          </button>
        </PopupMenu>
      )}
    </>
  );
}
