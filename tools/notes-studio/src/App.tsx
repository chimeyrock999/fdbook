import type { DocumentStatus } from '@fumadocs-editor/core/sync';
import { useEffect, useMemo, useState } from 'react';
import { createFilesClient } from './api/files';
import { createLintClient } from './api/lint';
import { createTreeClient } from './api/tree';
import { NoteEditor } from './editor/NoteEditor';
import { NoteGate } from './notes/NoteGate';
import { OpenOnSite } from './notes/OpenOnSite';
import { NOTES_PREFIX, noteFromUrl, syncPath } from './notes/notes';
import { PageTree } from './tree/PageTree';
import { renamedPath } from './tree/tree';
import { useTree } from './tree/useTree';

export function App() {
  const files = useMemo(() => createFilesClient(), []);
  const lint = useMemo(() => createLintClient(), []);
  const treeClient = useMemo(() => createTreeClient(), []);
  const { tree, error, reload } = useTree(treeClient, files);
  const [active, setActive] = useState(() => noteFromUrl(window.location.search));
  // The open note's autosave state, by path: a rename waits until it is saved.
  const [saved, setSaved] = useState<{ path: string; status: DocumentStatus } | null>(null);
  const unsaved = active !== null && (saved?.path !== active || saved.status !== 'synced') ? syncPath(active) : null;
  const [drawer, setDrawer] = useState<'notes' | 'panel' | null>(null);

  // Back and forward move between opened notes.
  useEffect(() => {
    const onPop = () => { setActive(noteFromUrl(window.location.search)); };
    window.addEventListener('popstate', onPop);
    return () => { window.removeEventListener('popstate', onPop); };
  }, []);

  const open = (path: string) => {
    setDrawer(null);
    if (path === active) return;
    window.history.pushState(null, '', `?path=${encodeURIComponent(path)}`);
    setActive(path);
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
        <button type="button" className="studio-button md:hidden" onClick={() => { setDrawer('notes'); }}>
          Notes
        </button>
        <span className="font-semibold whitespace-nowrap">Notes Studio</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--fde-muted-foreground)]">{active ?? ''}</span>
        {active && <OpenOnSite path={active} />}
        {active && (
          <button type="button" className="studio-button lg:hidden" onClick={() => { setDrawer('panel'); }}>
            Panel
          </button>
        )}
      </header>
      <div className="relative flex min-h-0 flex-1">
        <aside aria-label="Notes panel" className={`studio-notes ${drawer === 'notes' ? 'studio-drawer-open' : ''}`}>
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
        </aside>
        {drawer === 'notes' && <button type="button" aria-label="Close notes" className="studio-scrim md:hidden" onClick={() => { setDrawer(null); }} />}
        {active ? (
          <NoteGate files={files} path={active}>
            <NoteEditor
              key={active}
              path={syncPath(active)}
              onStatus={(status) => { setSaved({ path: active, status }); }}
              files={files}
              lint={lint}
              panelOpen={drawer === 'panel'}
              onOpenPanel={() => { setDrawer('panel'); }}
              onClosePanel={() => { setDrawer(null); }}
            />
          </NoteGate>
        ) : (
          <p className="m-auto p-6 text-[13px] text-[var(--fde-muted-foreground)]">Pick a note to edit.</p>
        )}
      </div>
    </div>
  );
}
