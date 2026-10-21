import type { DocumentStatus } from '@fumadocs-editor/core/sync';
import { MdxEditor, useEditorMode, useSourceText, useSyncStatus } from '@fumadocs-editor/ui';
import { useRef, useState, type ReactNode } from 'react';
import type { createFilesClient } from '../api/files';
import type { LintClient, LintIssue } from '../api/lint';
import { FrontmatterForm } from '../frontmatter/FrontmatterForm';
import { IssuesChip, IssuesPanel } from '../lint/IssuesPanel';
import { useLint } from '../lint/useLint';
import { NOTES_PREFIX } from '../notes/notes';
import { editorConfig } from '../plugins';
import { decorationsPlugin, useEditorPlugin } from './decorations';
import { NoteHeader } from './NoteHeader';
import type { RevealRequest } from './reveal';
import { SourceEditor } from './SourceEditor';
import { ConflictDialog, SaveStatus } from './SyncState';

type Panels = { panelOpen: boolean; onOpenPanel: () => void; onClosePanel: () => void };
type Clients = { files: ReturnType<typeof createFilesClient>; lint: LintClient };

// Below this width the side panel is a drawer (see .studio-panel).
const DRAWER_QUERY = '(max-width: 1023px)';

// One note, open through the notes sync socket: autosave, live merge of
// changes made on disk, and the conflict choice when both sides edited the
// same block. `path` is relative to content/notes; the caller remounts this
// per path. The side panel holds the frontmatter form and the lint issues.
export function NoteEditor({ path, ...rest }: { path: string } & Panels & Clients) {
  // Null until the server sent the file. A denied open never reports it, so
  // the status, not `writable` alone, decides whether editing is allowed.
  const [writable, setWritable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<DocumentStatus | null>(null);
  const locked = writable === false || status === 'denied';
  return (
    <MdxEditor.Root
      sync={{
        path,
        onOpen: (opened) => {
          setWritable(opened.writable);
        },
        onStatus: setStatus,
      }}
      components={editorConfig.components}
      syntax={editorConfig.syntax}
      editable={!locked}
    >
      <EditorLayout
        notePath={`${NOTES_PREFIX}${path}`}
        opened={writable !== null}
        status={writable === null && status !== 'denied' && status !== 'offline' ? null : (status ?? 'synced')}
        locked={locked}
        {...rest}
      />
    </MdxEditor.Root>
  );
}

// The plugins' decorations, one ProseMirror plugin for every editor.
const decorations = decorationsPlugin(editorConfig.decorators);

function EditorLayout({ notePath, opened, status, locked, panelOpen, onOpenPanel, onClosePanel, files, lint }: {
  notePath: string;
  opened: boolean;
  status: DocumentStatus | null;
  locked: boolean;
} & Panels & Clients) {
  const { mode, setMode, canShowVisual } = useEditorMode();
  const sync = useSyncStatus();
  const source = useSourceText();
  const [tab, setTab] = useState<'frontmatter' | 'issues'>('frontmatter');
  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const editor = useRef<HTMLElement>(null);
  const panel = useRef<HTMLElement>(null);
  useEditorPlugin(editor, decorations);
  // Only once the server sent the note: before that (still opening, denied,
  // offline) the text is empty, and an empty note would pass as clean.
  const lintState = useLint(lint, files, notePath, opened ? source.value : null);
  // A request is for the Source on screen now; a later Source starts fresh.
  if (mode !== 'source' && reveal !== null) setReveal(null);

  // The header puts the focus on the frontmatter's title field, in the panel
  // (a drawer to open first below 1024px).
  const openFrontmatter = () => {
    setTab('frontmatter');
    if (window.matchMedia(DRAWER_QUERY).matches) onOpenPanel();
    requestAnimationFrame(() => { panel.current?.querySelector('input')?.focus(); });
  };
  const openIssues = () => {
    setTab('issues');
    if (window.matchMedia(DRAWER_QUERY).matches) onOpenPanel();
  };
  // Issue positions are into the source text, so show it in Source.
  const showIssue = (issue: LintIssue) => {
    setMode('source');
    setReveal((previous) => ({ start: issue.start, end: issue.end, seq: (previous?.seq ?? 0) + 1 }));
    onClosePanel();
  };

  const form = (
    <FrontmatterForm
      source={source.value}
      onSource={source.onChange}
      readOnly={source.readOnly || locked}
      onOpenSource={() => {
        setMode('source');
        onClosePanel();
      }}
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section ref={editor} aria-label="Editor" className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--fde-background)]">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--fde-border)] px-4 py-2">
          <SaveStatus status={status} />
          <IssuesChip state={lintState} onOpen={openIssues} />
          <span className="flex-1" />
          <div role="tablist" aria-label="Mode" className="inline-flex rounded-lg border border-[var(--fde-border)] bg-[var(--fde-card)] p-0.5">
            <Tab selected={mode === 'visual'} disabled={!canShowVisual} onSelect={() => { setMode('visual'); }}>
              Visual
            </Tab>
            <Tab selected={mode === 'source'} onSelect={() => { setMode('source'); }}>
              Source
            </Tab>
          </div>
        </div>
        {mode === 'visual' ? (
          <div className="studio-visual min-h-0 flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-[52rem] px-[clamp(16px,5vw,56px)] py-7">
              <NoteHeader source={source.value} onOpen={openFrontmatter} />
              <MdxEditor.Visual className="studio-prose" />
            </div>
          </div>
        ) : (
          <SourceEditor reveal={reveal} />
        )}
      </section>
      <aside ref={panel} className={`studio-panel ${panelOpen ? 'studio-drawer-open' : ''}`} aria-label="Side panel">
        <div role="tablist" aria-label="Panel" className="studio-panel-tabs">
          <PanelTab selected={tab === 'frontmatter'} onSelect={() => { setTab('frontmatter'); }}>
            Frontmatter
          </PanelTab>
          <PanelTab selected={tab === 'issues'} onSelect={() => { setTab('issues'); }}>
            Issues
            {lintState.issues !== null && lintState.issues.length > 0 && (
              <span
                className={`rounded-full px-1.5 text-[11px] font-semibold text-[var(--fde-background)] tabular-nums ${lintState.issues.some((issue) => issue.severity === 'error') ? 'bg-[var(--fde-error)]' : 'bg-[var(--fde-warning)]'}`}
              >
                {lintState.issues.length}
              </span>
            )}
          </PanelTab>
        </div>
        <div className="studio-panel-body">
          {tab === 'frontmatter' ? form : <IssuesPanel state={lintState} onSelect={showIssue} />}
        </div>
      </aside>
      {panelOpen && <button type="button" aria-label="Close panel" className="studio-scrim lg:hidden" onClick={onClosePanel} />}
      {status === 'conflict' && sync && <ConflictDialog onKeepMine={sync.keepMine} onTakeDisk={sync.takeDisk} />}
    </div>
  );
}

function Tab({ selected, disabled = false, onSelect, children }: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      disabled={disabled}
      title={disabled ? 'The source does not parse yet' : undefined}
      onClick={onSelect}
      className={`rounded-md px-3 py-0.5 text-[12.5px] disabled:opacity-50 ${selected ? 'bg-[var(--fde-background)] font-semibold shadow-sm' : ''}`}
    >
      {children}
    </button>
  );
}

function PanelTab({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`inline-flex items-center gap-1.5 border-b-2 px-2.5 pt-1.5 pb-2 text-[13px] ${selected ? 'border-[var(--fde-foreground)] font-semibold' : 'border-transparent text-[var(--fde-muted-foreground)]'}`}
    >
      {children}
    </button>
  );
}
