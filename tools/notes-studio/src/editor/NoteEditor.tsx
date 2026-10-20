import type { DocumentStatus } from '@fumadocs-editor/core/sync';
import { MdxEditor, useEditorMode, useSourceText, useSyncStatus } from '@fumadocs-editor/ui';
import { useState, type ReactNode } from 'react';
import { FrontmatterForm } from '../frontmatter/FrontmatterForm';
import { editorConfig } from '../plugins';
import { SourceEditor } from './SourceEditor';
import { ConflictDialog, SaveStatus } from './SyncState';

// One note, open through the notes sync socket: autosave, live merge of
// changes made on disk, and the conflict choice when both sides edited the
// same block. `path` is relative to content/notes; the caller remounts this
// per path.
export function NoteEditor({ path, frontmatterOpen, onCloseFrontmatter }: {
  path: string;
  frontmatterOpen: boolean;
  onCloseFrontmatter: () => void;
}) {
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
        status={writable === null && status !== 'denied' && status !== 'offline' ? null : (status ?? 'synced')}
        locked={locked}
        frontmatterOpen={frontmatterOpen}
        onCloseFrontmatter={onCloseFrontmatter}
      />
    </MdxEditor.Root>
  );
}

function EditorLayout({ status, locked, frontmatterOpen, onCloseFrontmatter }: {
  status: DocumentStatus | null;
  locked: boolean;
  frontmatterOpen: boolean;
  onCloseFrontmatter: () => void;
}) {
  const { mode, setMode, canShowVisual } = useEditorMode();
  const sync = useSyncStatus();
  const source = useSourceText();


  const form = (
    <FrontmatterForm
      source={source.value}
      onSource={source.onChange}
      readOnly={source.readOnly || locked}
      onOpenSource={() => {
        setMode('source');
        onCloseFrontmatter();
      }}
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section aria-label="Editor" className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--fde-background)]">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--fde-border)] px-4 py-2">
          <SaveStatus status={status} />
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
            <MdxEditor.Visual className="mx-auto w-full max-w-[52rem] px-[clamp(16px,5vw,56px)] py-7" />
          </div>
        ) : (
          <SourceEditor />
        )}
      </section>
      <aside
        className={`studio-frontmatter ${frontmatterOpen ? 'studio-drawer-open' : ''}`}
        aria-label="Frontmatter panel"
      >
        {form}
      </aside>
      {frontmatterOpen && <button type="button" aria-label="Close frontmatter" className="studio-scrim lg:hidden" onClick={onCloseFrontmatter} />}
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
