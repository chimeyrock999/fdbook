import { ChevronRight, FileCode, Folder, Image, List, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AssetAnswer, AssetInfo, AssetsClient, AssetUsage } from '../api/assets';
import { assetDirFor } from '../media/asset-names';
import { buildAssetTree, foldersTo, nameOf, type AssetFolder } from './asset-tree';
import { DeleteAssetDialog, RenameAssetDialog, UsageList } from './AssetDialogs';
import type { useAssetList } from './useAssetList';

type Menu = { asset: AssetInfo; top: number; left: number };
type Dialog = { kind: 'rename' | 'delete'; asset: AssetInfo };

const IMAGE = /\.(avif|gif|jpe?g|png|svg|webp)$/i;
const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? '' : 's'}`;

function said(answer: AssetAnswer) {
  const move = answer.changes.find((change) => change.type === 'move');
  if (!move) return `Deleted ${answer.changes[0]?.path ?? 'the file'}.`;
  const notes = answer.changes.filter((change) => change.type === 'change').length;
  const refs = answer.usages.length;
  return notes === 0 ? `Renamed to ${nameOf(move.to)}.` : `Renamed to ${nameOf(move.to)}; updated ${plural(refs, 'reference')} in ${plural(notes, 'note')}.`;
}

// What the rows need from the view around them.
type View = {
  filtering: boolean;
  open: ReadonlySet<string>;
  toggle: (path: string) => void;
  expanded: string | null;
  expand: (path: string) => void;
  openMenu: (menu: Menu) => void;
  onOpenUsage: (usage: AssetUsage) => void;
};

function FileRow({ asset, view }: { asset: AssetInfo; view: View }) {
  const name = nameOf(asset.path);
  const dot = name.lastIndexOf('.');
  const used = asset.usages.length;
  const expanded = view.expanded === asset.path;
  return (
    <li>
      <div className="studio-tree-row" aria-current={expanded ? 'true' : undefined}>
        <span className="studio-tree-chevron" />
        <button type="button" className="studio-tree-label" title={asset.path} aria-expanded={expanded} onClick={() => { view.expand(asset.path); }}>
          {IMAGE.test(name) ? <Image size={16} /> : <FileCode size={16} />}
          <span className="truncate">
            {name.slice(0, dot)}
            <span className="text-[var(--fde-muted-foreground)]">{name.slice(dot)}</span>
          </span>
        </button>
        <span className="studio-asset-uses" data-unused={used === 0 || undefined} title={used === 0 ? 'No note uses it' : `Used ${plural(used, 'time')}`}>
          {used === 0 ? 'unused' : `${String(used)}×`}
        </span>
        <button
          type="button"
          className="studio-tree-more"
          aria-label={`Actions for ${name}`}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            view.openMenu({ asset, top: box.bottom + 2, left: box.left });
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
      {expanded && (
        <div className="studio-asset-expanded">
          {used === 0 ? <p className="studio-tree-status">No note uses it.</p> : <UsageList usages={asset.usages} onOpen={view.onOpenUsage} />}
        </div>
      )}
    </li>
  );
}

function FolderItems({ folder, nested = false, view }: { folder: AssetFolder; nested?: boolean; view: View }) {
  return (
    <ul role="group" className={nested ? 'studio-tree-group studio-tree-nested' : 'studio-tree-group'}>
      {folder.folders.map((child) => {
        const open = view.filtering || view.open.has(child.path);
        return (
          <li key={child.path}>
            <div className="studio-tree-row">
              <button type="button" className="studio-tree-chevron" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${child.name}`} onClick={() => { view.toggle(child.path); }}>
                <ChevronRight size={14} data-open={open || undefined} />
              </button>
              <button type="button" className="studio-tree-label" title={child.path} onClick={() => { view.toggle(child.path); }}>
                <Folder size={16} />
                <span className="truncate">{child.name}</span>
              </button>
            </div>
            {open && <FolderItems folder={child} nested view={view} />}
          </li>
        );
      })}
      {folder.files.map((asset) => <FileRow key={asset.path} asset={asset} view={view} />)}
    </ul>
  );
}

// The sidebar's Assets view: public/notes as folders, each file with how
// many times notes use it. A file opens the list of the notes and lines
// that use it; its menu renames it (every reference follows) or deletes it
// (only once nothing uses it). `active` is the open note (a worktree path);
// while it has edits not on disk yet (`unsaved`), rename and delete wait,
// since the server only sees references that are saved.
export function AssetsView({ client, list, active, unsaved, onOpenUsage }: {
  client: AssetsClient;
  list: ReturnType<typeof useAssetList>;
  active: string | null;
  unsaved: boolean;
  onOpenUsage: (usage: AssetUsage) => void;
}) {
  const [query, setQuery] = useState('');
  const [unused, setUnused] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(active === null ? [] : foldersTo(assetDirFor(active))));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [shownFor, setShownFor] = useState(active);
  const menuRef = useRef<HTMLDivElement>(null);

  // The open note's asset folder shows when a note is opened.
  if (active !== shownFor) {
    setShownFor(active);
    if (active !== null) setOpen(new Set([...open, ...foldersTo(assetDirFor(active))]));
  }

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

  const { assets, error, reload } = list;
  if (assets === null) {
    return error === null
      ? <p className="px-3 py-2 text-[12.5px] text-[var(--fde-muted-foreground)]">Loading assets…</p>
      : <p role="alert" className="p-3 text-[12.5px] text-[var(--fde-error)]">Could not load the assets: {error}</p>;
  }
  const tree = buildAssetTree(assets, { query, unused });
  const unusedCount = assets.filter((asset) => asset.usages.length === 0).length;
  const view: View = {
    filtering: query.trim() !== '' || unused,
    open,
    toggle: (path) => {
      setOpen((current) => {
        const next = new Set(current);
        if (!next.delete(path)) next.add(path);
        return next;
      });
    },
    expanded,
    expand: (path) => { setExpanded((current) => (current === path ? null : path)); },
    openMenu: setMenu,
    onOpenUsage,
  };
  // The dialog works on the asset as listed now: its mtime and usages.
  const current = dialog && assets.find((asset) => asset.path === dialog.asset.path);
  const done = (answer: AssetAnswer) => {
    setDialog(null);
    setStatus({ text: said(answer), error: false });
    const move = answer.changes.find((change) => change.type === 'move');
    if (move?.type === 'move' && expanded === move.path) setExpanded(move.to);
    reload();
  };
  const empty = tree.folders.length === 0 && tree.files.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2.5">
      <input type="search" aria-label="Filter assets" placeholder="Filter by name" className="studio-input" value={query} onChange={(event) => { setQuery(event.target.value); }} />
      <div className="studio-asset-filter" role="group" aria-label="Show">
        <button type="button" aria-pressed={!unused} onClick={() => { setUnused(false); }}>All {assets.length}</button>
        <button type="button" aria-pressed={unused} onClick={() => { setUnused(true); }}>Unused {unusedCount}</button>
      </div>
      {error !== null && <p role="alert" className="studio-tree-error">Could not reload the assets: {error}</p>}
      {empty ? (
        <p className="px-2 text-[12.5px] text-[var(--fde-muted-foreground)]">{assets.length === 0 ? 'No files in public/notes yet.' : 'No asset matches.'}</p>
      ) : (
        <div className="min-h-0 overflow-auto"><FolderItems folder={tree} view={view} /></div>
      )}
      {status && (
        <p role={status.error ? 'alert' : 'status'} className={status.error ? 'studio-tree-error' : 'studio-tree-status'}>
          {status.text}
        </p>
      )}
      {menu !== null && (
        <div ref={menuRef} role="menu" className="studio-menu" style={{ top: menu.top, left: menu.left }}>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); setExpanded(menu.asset.path); }}>
            <List size={14} /> Show usage
          </button>
          <button type="button" role="menuitem" disabled={unsaved} onClick={() => { setMenu(null); setDialog({ kind: 'rename', asset: menu.asset }); }}>
            <Pencil size={14} /> Rename…
          </button>
          <hr />
          <button type="button" role="menuitem" className="studio-menu-danger" disabled={unsaved} onClick={() => { setMenu(null); setDialog({ kind: 'delete', asset: menu.asset }); }}>
            <Trash2 size={14} /> Delete…
          </button>
          {unsaved && <p className="studio-menu-hint">The open note has unsaved changes. Rename or delete once it shows Saved.</p>}
        </div>
      )}
      {dialog?.kind === 'rename' && current && (
        <RenameAssetDialog client={client} asset={current} onDone={done} onClose={() => { setDialog(null); }} />
      )}
      {dialog?.kind === 'delete' && current && (
        <DeleteAssetDialog
          client={client}
          asset={current}
          onDone={done}
          onClose={() => { setDialog(null); }}
          onOpenUsage={(usage) => { setDialog(null); onOpenUsage(usage); }}
        />
      )}
    </div>
  );
}
