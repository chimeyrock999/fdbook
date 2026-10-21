import { ArrowDown, ArrowUp, Check, ChevronRight, ExternalLink, EyeOff, FileText, Folder, GripVertical, Lock, MoreHorizontal, Pencil, Plus, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { TreeChange, TreeClient, TreeFolder, TreeNode, TreeRequest } from '../api/tree';
import { CreateDialog, RenameDialog } from './TreeDialogs';
import { dropIndex, filterTree, movable, noteOf, renamedPath, stepIndex, titleOf } from './tree';
import { useOpenFolders } from './useOpenFolders';

type Named = Extract<TreeNode, { kind: 'page' | 'folder' }>;
type Menu = { node: TreeNode; parent: TreeFolder; top: number; left: number };
type Dialog = { kind: 'create'; parent: TreeFolder; after: number | null } | { kind: 'rename'; node: Named };
type Drop = { id: string; place: 'before' | 'after' };

const HIDDEN_WHY = {
  unlisted: 'No meta.yaml lists it, so the site leaves it out of the sidebar.',
  'visible-false': '`visible: false`: the site leaves it out of the sidebar.',
};

function lockedWhy(node: TreeNode, parent: TreeFolder) {
  if ('hidden' in node && node.hidden === 'unlisted') return `${HIDDEN_WHY.unlisted} Add it to ${parent.meta ?? 'meta.yaml'} to order it.`;
  return `It has no entry of its own in ${parent.meta ?? 'meta.yaml'} (\`...\` or another meta.yaml lists it). Order it there.`;
}

function said(changes: TreeChange[]) {
  if (changes.length === 0) return 'Nothing to change.';
  const first = changes[0];
  if (first.type === 'add' && first.path.endsWith('meta.yaml')) return `Created ${first.path} with the new order.`;
  if (first.type === 'change' && first.detail.startsWith('defaultOpen')) return `Saved ${first.detail} in ${first.path}.`;
  if (first.type === 'change') return `Saved the order in ${first.path}.`;
  return 'Saved.';
}

// What the rows need from the tree around them.
type View = {
  active: string | null;
  filtering: boolean;
  isOpen: (folder: TreeFolder) => boolean;
  toggle: (folder: TreeFolder) => void;
  onOpen: (path: string) => void;
  dragging: { node: TreeNode; parent: TreeFolder } | null;
  drop: Drop | null;
  setDragging: (dragging: { node: TreeNode; parent: TreeFolder } | null) => void;
  setDrop: (drop: Drop | null) => void;
  onDragOver: (event: DragEvent, node: TreeNode, parent: TreeFolder) => void;
  onDrop: (event: DragEvent, node: TreeNode, parent: TreeFolder) => void;
  openMenu: (menu: Menu) => void;
};

function Row({ node, parent, dim, view }: { node: TreeNode; parent: TreeFolder; dim: boolean; view: View }) {
  const { active, filtering, isOpen, toggle, onOpen, dragging, drop, setDragging, setDrop, onDragOver, onDrop, openMenu } = view;
  const hidden = 'hidden' in node ? node.hidden : null;
  const note = noteOf(node);
  const open = node.kind === 'folder' && (filtering || isOpen(node));
  const canMove = movable(node) && !filtering;
  const faded = dim || hidden !== null;
  const select = () => {
    if (node.kind === 'folder' && (node.index === null || note === active)) toggle(node);
    else if (note !== null) onOpen(note);
  };
  return (
    <li
      draggable={canMove}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', node.id);
        event.stopPropagation();
        setDragging({ node, parent });
      }}
      onDragEnd={() => { setDragging(null); setDrop(null); }}
      className={dragging?.node === node ? 'opacity-40' : undefined}
    >
      <div
        className="studio-tree-row"
        data-drop={drop?.id === node.id ? drop.place : undefined}
        data-faded={faded || undefined}
        aria-current={note !== null && note === active ? 'page' : undefined}
        onDragOver={(event) => { onDragOver(event, node, parent); }}
        onDrop={(event) => { onDrop(event, node, parent); }}
      >
        {node.kind === 'folder' ? (
          <button type="button" className="studio-tree-chevron" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${node.title}`} onClick={() => { toggle(node); }}>
            <ChevronRight size={14} data-open={open || undefined} />
          </button>
        ) : (
          <span className="studio-tree-chevron" />
        )}
        {node.kind === 'separator' ? (
          <span className="studio-tree-separator">{node.title}</span>
        ) : node.kind === 'missing' ? (
          <span className="studio-tree-missing" title={`${node.meta}: “${node.value}” reaches no page or folder.`}>
            <TriangleAlert size={13} /> <span className="truncate">{node.value}</span> <small>missing</small>
          </span>
        ) : node.kind === 'link' ? (
          <span className="studio-tree-label" title={node.url}>
            <ExternalLink size={16} /> <span className="truncate">{node.title}</span>
          </span>
        ) : (
          <button type="button" className="studio-tree-label" title={node.path} onClick={select}>
            {node.kind === 'folder' ? <Folder size={16} /> : <FileText size={16} />}
            <span className="truncate">{node.title}</span>
          </button>
        )}
        {hidden && (
          <span className="studio-tree-badge" title={HIDDEN_WHY[hidden]}>
            <EyeOff size={11} /> hidden
          </span>
        )}
        {canMove ? (
          <span className="studio-tree-grip" aria-hidden="true"><GripVertical size={13} /></span>
        ) : node.entry === null && hidden !== 'unlisted' && node.kind !== 'missing' ? (
          <span className="studio-tree-grip" title={lockedWhy(node, parent)}><Lock size={12} /></span>
        ) : null}
        <button
          type="button"
          className="studio-tree-more"
          aria-label={`Actions for ${titleOf(node)}`}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            openMenu({ node, parent, top: box.bottom + 2, left: box.left });
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
      {node.kind === 'folder' && open && <Items folder={node} nested dim={faded} view={view} />}
    </li>
  );
}

// A level of the tree; nested levels hang off a guide line, as on the site.
function Items({ folder, nested = false, dim, view }: { folder: TreeFolder; nested?: boolean; dim: boolean; view: View }) {
  return (
    <ul role="group" className={nested ? 'studio-tree-group studio-tree-nested' : 'studio-tree-group'}>
      {folder.children.map((node) => <Row key={node.id} node={node} parent={folder} dim={dim} view={view} />)}
    </ul>
  );
}

// The notes as the site's sidebar shows them, from meta.yaml, plus what the
// site hides. Pages can be created, renamed and reordered here; every change
// goes through /api/tree. `active` and paths are relative to content/notes.
export function PageTree({ root, client, active, unsaved = null, onOpen, onRenamed, onChanged }: {
  root: TreeFolder | null;
  client: TreeClient;
  active: string | null;
  // The open note while it has edits not on disk yet: renaming it (or its
  // folder) would move the file under the editor and lose them.
  unsaved?: string | null;
  onOpen: (path: string) => void;
  onRenamed: (from: string, to: string) => void;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [dragging, setDragging] = useState<{ node: TreeNode; parent: TreeFolder } | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const { isOpen, toggle, openFolder } = useOpenFolders(root, active);
  const menuRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  // A plain folder just created: its row takes focus once the reloaded tree
  // shows it, so its menu (New page here) is at hand.
  const [reveal, setReveal] = useState<string | null>(null);

  useEffect(() => {
    if (reveal === null) return;
    const label = [...(navRef.current?.querySelectorAll<HTMLElement>('.studio-tree-label') ?? [])].find((each) => each.title === reveal);
    if (!label) return;
    label.focus();
    setReveal(null);
  }, [root, reveal]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  // A change from the row menu, reported in the status line.
  const send = (request: TreeRequest) => {
    setMenu(null);
    client.change(request).then(
      (answer) => { setStatus({ text: said(answer.changes), error: false }); },
      (reason: unknown) => { setStatus({ text: reason instanceof Error ? reason.message : String(reason), error: true }); },
    ).finally(onChanged);
  };

  const move = (parent: TreeFolder, node: TreeNode, to: number | null) => {
    setMenu(null);
    if (to === null || node.entry === null) return;
    send({ op: 'move', folder: parent.path, from: node.entry, to, baseMtime: parent.metaMtime });
  };

  if (!root) return <p className="px-3 py-2 text-[12.5px] text-[var(--fde-muted-foreground)]">Loading notes…</p>;
  const shown = filterTree(root, query);
  const filtering = query.trim() !== '';

  const onDragOver = (event: DragEvent, node: TreeNode, parent: TreeFolder) => {
    if (dragging?.parent !== parent || !movable(node) || dragging.node === node) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    const place = event.clientY < box.top + box.height / 2 ? 'before' : 'after';
    if (drop?.id !== node.id || drop.place !== place) setDrop({ id: node.id, place });
  };

  const onDrop = (event: DragEvent, node: TreeNode, parent: TreeFolder) => {
    event.preventDefault();
    if (dragging && drop?.id === node.id) move(parent, dragging.node, dropIndex(dragging.node, node, drop.place));
    setDragging(null);
    setDrop(null);
  };

  const view: View = { active, filtering, isOpen, toggle, onOpen, dragging, drop, setDragging, setDrop, onDragOver, onDrop, openMenu: setMenu };
  const menuNode = menu?.node ?? null;
  const movesUnsaved =
    unsaved !== null && (menuNode?.kind === 'page' || menuNode?.kind === 'folder') && renamedPath(unsaved, menuNode.path, menuNode.path) !== null;
  return (
    <nav ref={navRef} aria-label="Page tree" className="flex min-h-0 flex-1 flex-col gap-2 p-2.5">
      <div className="flex gap-1.5">
        <input
          type="search"
          aria-label="Filter notes"
          placeholder="Filter by title"
          className="studio-input"
          value={query}
          onChange={(event) => { setQuery(event.target.value); }}
        />
        <button type="button" className="studio-icon-button" aria-label="New page" title="New page" onClick={() => { setDialog({ kind: 'create', parent: root, after: null }); }}>
          <Plus size={15} />
        </button>
      </div>
      {shown.children.length === 0 ? (
        <p className="px-2 text-[12.5px] text-[var(--fde-muted-foreground)]">No note matches “{query}”.</p>
      ) : (
        <div className="min-h-0 overflow-auto"><Items folder={shown} dim={false} view={view} /></div>
      )}
      {status && (
        <p role={status.error ? 'alert' : 'status'} className={status.error ? 'studio-tree-error' : 'studio-tree-status'}>
          {status.text}
        </p>
      )}
      {menu !== null && menuNode !== null && (
        <div ref={menuRef} role="menu" className="studio-menu" style={{ top: menu.top, left: menu.left }}>
          {menuNode.kind === 'folder' && (
            <button type="button" role="menuitem" onClick={() => { setMenu(null); setDialog({ kind: 'create', parent: menuNode, after: null }); }}>
              <Plus size={14} /> New page here
            </button>
          )}
          {menuNode.kind !== 'folder' && (
            <button type="button" role="menuitem" onClick={() => { setMenu(null); setDialog({ kind: 'create', parent: menu.parent, after: menuNode.entry }); }}>
              <Plus size={14} /> New page below
            </button>
          )}
          {(menuNode.kind === 'page' || menuNode.kind === 'folder') && (
            <button
              type="button"
              role="menuitem"
              disabled={menuNode.path === 'index.mdx' || menuNode.path === '' || movesUnsaved}
              onClick={() => { setMenu(null); setDialog({ kind: 'rename', node: menuNode }); }}
            >
              <Pencil size={14} /> Rename…
            </button>
          )}
          {movesUnsaved && <p className="studio-menu-hint">The open note has unsaved changes. Rename once it shows Saved.</p>}
          {menuNode.kind === 'folder' && (
            <>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={menuNode.defaultOpen}
                disabled={menuNode.meta === null}
                onClick={() => { send({ op: 'set-open', folder: menuNode.path, defaultOpen: !menuNode.defaultOpen, baseMtime: menuNode.metaMtime }); }}
              >
                <span className="studio-menu-check">{menuNode.defaultOpen && <Check size={14} />}</span> Open by default on the site
              </button>
              {menuNode.meta === null && <p className="studio-menu-hint">No meta.yaml: order the folder first, or add one.</p>}
            </>
          )}
          <hr />
          <button type="button" role="menuitem" disabled={filtering || stepIndex(menu.parent, menuNode, -1) === null} onClick={() => { move(menu.parent, menuNode, stepIndex(menu.parent, menuNode, -1)); }}>
            <ArrowUp size={14} /> Move up
          </button>
          <button type="button" role="menuitem" disabled={filtering || stepIndex(menu.parent, menuNode, 1) === null} onClick={() => { move(menu.parent, menuNode, stepIndex(menu.parent, menuNode, 1)); }}>
            <ArrowDown size={14} /> Move down
          </button>
          {!movable(menuNode) && menuNode.kind !== 'missing' && <p className="studio-menu-hint">{lockedWhy(menuNode, menu.parent)}</p>}
          {filtering && <p className="studio-menu-hint">Clear the filter to reorder.</p>}
        </div>
      )}
      {dialog?.kind === 'create' && (
        <CreateDialog
          client={client}
          parent={dialog.parent}
          after={dialog.after}
          onClose={() => { setDialog(null); }}
          onDone={(created) => {
            openFolder(dialog.parent);
            setDialog(null);
            onChanged();
            if ('open' in created) {
              setStatus({ text: `Created ${created.open}.`, error: false });
              onOpen(created.open);
            } else {
              openFolder({ id: `folder:${created.folder}` });
              setReveal(created.folder);
              setStatus({ text: `Created ${created.folder}/.`, error: false });
            }
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <RenameDialog
          client={client}
          node={dialog.node}
          unsaved={unsaved}
          onClose={() => { setDialog(null); }}
          onDone={(from, to) => {
            setDialog(null);
            setStatus({ text: `Renamed to ${to}.`, error: false });
            onChanged();
            onRenamed(from, to);
          }}
        />
      )}
    </nav>
  );
}
