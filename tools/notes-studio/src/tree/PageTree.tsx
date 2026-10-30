import { ArrowDown, ArrowUp, Check, ChevronRight, ExternalLink, Eye, EyeOff, FileText, Folder, GripVertical, icons, Lock, MoreHorizontal, Pencil, Plus, Trash2, TriangleAlert, type LucideIcon } from 'lucide-react';
import { createElement, useEffect, useRef, useState, type DragEvent } from 'react';
import { useBusy } from '../actions/busy';
import { Spinner } from '../actions/PendingButton';
import type { DeleteProposalView } from '../api/proposals';
import type { TreeAnswer, TreeChange, TreeClient, TreeFolder, TreeNode, TreeRequest } from '../api/tree';
import { CHANGE_NAME, folderMarked, missingStatus, type TreeMarks } from '../changes/marks';
import { DeleteDialog, type DeleteTarget } from './DeleteDialog';
import { CreateDialog, RenameDialog } from './TreeDialogs';
import { dropIndex, filterTree, folderAt, movable, noteOf, renamedPath, stepIndex, titleOf } from './tree';
import { useOpenFolders } from './useOpenFolders';

type Named = Extract<TreeNode, { kind: 'page' | 'folder' }>;
type Menu = { node: TreeNode; parent: TreeFolder; top: number; left: number };
type Dialog = { kind: 'create'; parent: TreeFolder; after: number | null } | { kind: 'rename'; node: Named } | { kind: 'delete'; target: DeleteTarget; proposal: DeleteProposalView | null };
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
  readOnly: boolean;
  marks: TreeMarks | null;
  suggested: ReadonlyMap<string, number> | null;
  deleting: ReadonlyMap<string, DeleteProposalView> | null;
  // A change from a row menu or a drop is out (#138): rows neither move
  // nor open their menu until the tree is read again; `changing` is the
  // row it is about.
  busy: boolean;
  changing: string | null;
};

// The icon the site's sidebar shows. The server keeps only names the site's
// lucide has (server/tree/build.ts); the Studio's lucide-react, already
// loaded for the UI, still has every one. Null: Folder / FileText.
const iconOf = (name: string | null): LucideIcon | undefined => (name === null ? undefined : (icons as Partial<Record<string, LucideIcon>>)[name]);

function Row({ node, parent, dim, view }: { node: TreeNode; parent: TreeFolder; dim: boolean; view: View }) {
  const { active, filtering, isOpen, toggle, onOpen, dragging, drop, setDragging, setDrop, onDragOver, onDrop, openMenu, readOnly, marks, suggested, deleting, busy, changing } = view;
  const hidden = 'hidden' in node ? node.hidden : null;
  const note = noteOf(node);
  const open = node.kind === 'folder' && (filtering || isOpen(node));
  const canMove = movable(node) && !filtering && !readOnly && !busy;
  const faded = dim || hidden !== null;
  // Its git status (#17): the note's, or a missing entry's deleted page.
  const change = marks === null ? null : node.kind === 'missing' ? missingStatus(marks, node) : note === null ? null : (marks.notes.get(note) ?? null);
  const dot = marks !== null && node.kind === 'folder' && folderMarked(marks, node, open);
  const waiting = note === null ? 0 : (suggested?.get(note) ?? 0);
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
        aria-busy={changing === node.id || undefined}
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
          <button type="button" className="studio-tree-label" title={node.path} data-path={node.path} data-change={change ?? undefined} onClick={select}>
            {createElement(iconOf(node.icon) ?? (node.kind === 'folder' ? Folder : FileText), { size: 16, 'aria-hidden': true })}
            <span className="truncate">{node.title}</span>
          </button>
        )}
        {hidden && (
          <span className="studio-tree-badge" title={HIDDEN_WHY[hidden]}>
            <EyeOff size={11} /> hidden
          </span>
        )}
        {dot && <span className="studio-tree-dot" title="Changes inside" />}
        {change !== null && <span className="studio-change-mark" data-change={change} title={CHANGE_NAME[change]}>{change}</span>}
        {waiting > 0 && <span className="studio-suggest-mark" title={waiting === 1 ? '1 suggestion waiting' : `${String(waiting)} suggestions waiting`}>{waiting}</span>}
        {(node.kind === 'page' || node.kind === 'folder') && deleting?.has(node.path) === true && (
          <span className="studio-delete-mark" title={`${deleting.get(node.path)?.by.kind === 'run' ? 'An agent' : 'Someone'} proposed deleting it`}><Trash2 size={11} aria-label="Delete proposed" /></span>
        )}
        {canMove ? (
          <span className="studio-tree-grip" aria-hidden="true"><GripVertical size={13} /></span>
        ) : !readOnly && node.entry === null && hidden !== 'unlisted' && node.kind !== 'missing' ? (
          <span className="studio-tree-grip" title={lockedWhy(node, parent)}><Lock size={12} /></span>
        ) : null}
        {!readOnly && (
          <button
            type="button"
            className="studio-tree-more"
            aria-label={`Actions for ${titleOf(node)}`}
            disabled={busy}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              openMenu({ node, parent, top: box.bottom + 2, left: box.left });
            }}
          >
            {changing === node.id ? <Spinner size={14} /> : <MoreHorizontal size={14} />}
          </button>
        )}
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
// site hides. Pages can be created, renamed, reordered, hidden and shown here; every change
// goes through /api/tree. `active` and paths are relative to content/notes.
// `readOnly` (main) shows the tree only: no new page, row menu or drag.
export function PageTree({ root, client, active, unsaved = null, readOnly = false, marks = null, suggested = null, deleting = null, onOpen, onRenamed, onChanged, onDeleted, onShowDeleted, onDecideDelete }: {
  root: TreeFolder | null;
  client: TreeClient;
  active: string | null;
  // The open note while it has edits not on disk yet: renaming it (or its
  // folder) would move the file under the editor and lose them.
  unsaved?: string | null;
  readOnly?: boolean;
  // The worktree's git changes, marked on the rows (src/changes/marks.ts).
  marks?: TreeMarks | null;
  // Agent suggestions waiting per note, by path relative to content/notes (#85).
  suggested?: ReadonlyMap<string, number> | null;
  // Open delete proposals, by the page or folder they would delete.
  deleting?: ReadonlyMap<string, DeleteProposalView> | null;
  onOpen: (path: string) => void;
  onRenamed: (from: string, to: string) => void;
  // Reloads the tree; resolves whether the load set one.
  onChanged: () => Promise<boolean>;
  // A delete went through (it reloads the tree), and where to restore from.
  onDeleted?: (answer: TreeAnswer) => void;
  onShowDeleted?: () => void;
  // Accepts (with the dry run's base) or rejects a delete proposal.
  onDecideDelete?: (id: string, op: 'accept' | 'reject', base?: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // What the last change did; a failed one says why in a toast.
  // `restore`: it was a delete, so the status points to Deleted pages.
  const [status, setStatus] = useState<{ text: string; restore: boolean } | null>(null);
  const say = (text: string | null, restore = false) => { setStatus(text === null ? null : { text, restore }); };
  const action = useBusy();
  const [dragging, setDragging] = useState<{ node: TreeNode; parent: TreeFolder } | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const { isOpen, toggle, openFolder } = useOpenFolders(root, active);
  const menuRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  // A plain folder just created: its row takes focus on the next tree, the
  // reload after the create, so its menu (New page here) is at hand. Only
  // that once: if that tree lacks it, or the filter hides the row, a later
  // reload does not take the focus from where the reader is. A reload that
  // fails sets no tree, so it drops the focus itself.
  const reveal = useRef<string | null>(null);

  useEffect(() => {
    const path = reveal.current;
    reveal.current = null;
    if (path === null || !root || !folderAt(root, path)) return;
    navRef.current?.querySelector<HTMLElement>(`.studio-tree-label[data-path="${CSS.escape(path)}"]`)?.focus();
  }, [root]);

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

  // A change from the row menu or a drop, reported in the status line.
  // The tree waits for it and for the tree it reads after, so no second
  // change goes out on what the first one changed (its meta.yaml mtime).
  const send = (node: TreeNode, request: TreeRequest, report: (changes: TreeChange[]) => string) => {
    setMenu(null);
    say(null);
    void action.run(async () => {
      try {
        say(report((await client.change(request)).changes));
      } finally {
        await onChanged();
      }
    }, node.id);
  };

  const move = (parent: TreeFolder, node: TreeNode, to: number | null) => {
    if (to === null || node.entry === null) {
      setMenu(null);
      return;
    }
    send(node, { op: 'move', folder: parent.path, from: node.entry, to, baseMtime: parent.metaMtime }, said);
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

  const view: View = { active, filtering, isOpen, toggle, onOpen, dragging, drop, setDragging, setDrop, onDragOver, onDrop, openMenu: setMenu, readOnly, marks, suggested, deleting, busy: action.busy, changing: action.running };
  const menuNode = menu?.node ?? null;
  const movesUnsaved =
    unsaved !== null && (menuNode?.kind === 'page' || menuNode?.kind === 'folder') && renamedPath(unsaved, menuNode.path, menuNode.path) !== null;
  // Hiding or showing a page writes its frontmatter; a folder's only its
  // meta.yaml. An unlisted page counts too: it may also say visible: false.
  const writesUnsaved = movesUnsaved && menuNode.kind === 'page';
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
        {!readOnly && (
          <button type="button" className="studio-icon-button" aria-label="New page" title="New page" onClick={() => { setDialog({ kind: 'create', parent: root, after: null }); }}>
            <Plus size={15} />
          </button>
        )}
      </div>
      {shown.children.length === 0 ? (
        <p className="px-2 text-[12.5px] text-[var(--fde-muted-foreground)]">No note matches “{query}”.</p>
      ) : (
        <div className="min-h-0 overflow-auto"><Items folder={shown} dim={false} view={view} /></div>
      )}
      {status !== null && (
        <p role="status" className="studio-tree-status">
          {status.text}
          {status.restore && onShowDeleted && <> <button type="button" className="studio-agent-link" onClick={onShowDeleted}>Restore it from Deleted pages</button></>}
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
          {(menuNode.kind === 'page' || menuNode.kind === 'folder') && (
            <button
              type="button"
              role="menuitem"
              disabled={menuNode.path === 'index.mdx' || menuNode.path === '' || writesUnsaved}
              onClick={() => {
                const visible = menuNode.hidden !== null;
                send(menuNode, { op: 'visibility', path: menuNode.path, visible }, (changes) =>
                  changes.length === 0 ? 'Nothing to change.' : visible ? `Showed ${menuNode.path} in the sidebar.` : `Hid ${menuNode.path} from the sidebar.`);
              }}
            >
              {menuNode.hidden === null ? <><EyeOff size={14} /> Hide from sidebar</> : <><Eye size={14} /> Show in sidebar</>}
            </button>
          )}
          {movesUnsaved && (
            <p className="studio-menu-hint">
              The open note has unsaved changes. {writesUnsaved ? `Rename, ${menuNode.hidden !== null ? 'show' : 'hide'} or delete it` : 'Rename or delete'} once it shows Saved.
            </p>
          )}
          {menuNode.kind === 'folder' && (
            <>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={menuNode.defaultOpen}
                disabled={menuNode.meta === null}
                onClick={() => {
                  const defaultOpen = !menuNode.defaultOpen;
                  send(menuNode, { op: 'set-open', folder: menuNode.path, defaultOpen, baseMtime: menuNode.metaMtime }, (changes) =>
                    changes.length === 0 ? 'Nothing to change.' : `Saved defaultOpen: ${String(defaultOpen)} in ${menuNode.meta ?? 'meta.yaml'}.`);
                }}
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
          {(menuNode.kind === 'page' || menuNode.kind === 'folder') && (
            <>
              <hr />
              <button
                type="button"
                role="menuitem"
                className="studio-menu-danger"
                disabled={menuNode.path === 'index.mdx' || menuNode.path === '' || movesUnsaved}
                onClick={() => {
                  setMenu(null);
                  setDialog({ kind: 'delete', target: { path: menuNode.path, title: menuNode.title, folder: menuNode.kind === 'folder' }, proposal: deleting?.get(menuNode.path) ?? null });
                }}
              >
                <Trash2 size={14} /> {deleting?.has(menuNode.path) === true ? 'Review proposed delete…' : 'Delete…'}
              </button>
            </>
          )}
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
            const reloaded = onChanged();
            if ('open' in created) {
              say(`Created ${created.open}.`);
              onOpen(created.open);
            } else {
              openFolder({ id: `folder:${created.folder}` });
              reveal.current = created.folder;
              say(`Created ${created.folder}/.`);
              void reloaded.then((loaded) => {
                if (!loaded && reveal.current === created.folder) reveal.current = null;
              });
            }
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog
          client={client}
          target={dialog.target}
          proposal={dialog.proposal}
          onAccept={dialog.proposal === null || !onDecideDelete ? undefined : (base) => onDecideDelete(dialog.proposal?.id ?? '', 'accept', base)}
          onReject={dialog.proposal === null || !onDecideDelete ? undefined : () => onDecideDelete(dialog.proposal?.id ?? '', 'reject')}
          onClose={() => { setDialog(null); }}
          onDone={(answer) => {
            setDialog(null);
            say(`Deleted ${dialog.target.folder ? `${dialog.target.path}/` : dialog.target.path}.`, true);
            void onChanged();
            onDeleted?.(answer);
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
            say(`Renamed to ${to}.`);
            void onChanged();
            onRenamed(from, to);
          }}
        />
      )}
    </nav>
  );
}
