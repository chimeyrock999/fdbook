import type { DocumentStatus } from '@fumadocs-editor/core/sync';
import { MdxEditor, useEditorMode, useSourceText, useSyncStatus } from '@fumadocs-editor/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { createFilesClient } from '../api/files';
import type { LintClient, LintIssue } from '../api/lint';
import { frontmatterPathAt } from '../frontmatter/frontmatter';
import type { FieldReveal } from '../frontmatter/MetadataStrip';
import { useFrontmatter } from '../frontmatter/useFrontmatter';
import { IssuesChip, IssuesPanel } from '../lint/IssuesPanel';
import { useLint } from '../lint/useLint';
import { UploadNotice } from '../media/UploadNotice';
import { useAssetUploads } from '../media/useAssetUploads';
import { NOTES_PREFIX } from '../notes/notes';
import type { IssueCount } from '../sidebar/Sidebar';
import { assetCompletion } from './asset-completion';
import { GraphTools } from '../graph/GraphTools';
import { editorConfig } from '../plugins';
import { decorationsPlugin, useEditorPlugin } from './decorations';
import { NoteHeader } from './NoteHeader';
import type { RevealRequest } from './reveal';
import { SourceEditor } from './SourceEditor';
import { ConflictDialog, SaveStatus } from './SyncState';
import './drag-handle.css';

// The sidebar's Issues view: the editor fills `issuesSlot` and reports the
// count for the activity bar. `onShowIssues` opens the view (the issues
// chip); `onIssueShown` follows a picked issue, so a phone's drawer closes.
type Panels = {
  issuesSlot: HTMLElement | null;
  onIssueCount: (count: IssueCount) => void;
  onShowIssues: () => void;
  onIssueShown: () => void;
};
type Clients = { files: ReturnType<typeof createFilesClient>; lint: LintClient };

// One note, open through the notes sync socket: autosave, live merge of
// changes made on disk, and the conflict choice when both sides edited the
// same block. `path` is relative to content/notes; the caller remounts this
// per path. The frontmatter is edited in the note header; the lint issues
// go to the sidebar's Issues view. Pasted, dropped and picked images are saved in the
// note's folder under public/notes, under a name asked for first; `assets`
// lists public/notes (useAssets), for the name check and Source. `onStatus`
// follows the autosave state, so a rename can wait for it.
export function NoteEditor({ path, assets, onStatus, ...rest }: {
  path: string;
  assets: readonly string[];
  onStatus?: (status: DocumentStatus) => void;
} & Panels & Clients) {
  const notePath = `${NOTES_PREFIX}${path}`;
  const uploads = useAssetUploads(rest.files, notePath, assets);
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
        onStatus: (next) => {
          setStatus(next);
          onStatus?.(next);
        },
      }}
      components={editorConfig.components}
      syntax={editorConfig.syntax}
      media={uploads.media}
      editable={!locked}
    >
      <EditorLayout
        notePath={notePath}
        assets={assets}
        uploads={uploads}
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

function EditorLayout({ notePath, assets, uploads, opened, status, locked, issuesSlot, onIssueCount, onShowIssues, onIssueShown, files, lint }: {
  notePath: string;
  assets: readonly string[];
  uploads: ReturnType<typeof useAssetUploads>;
  opened: boolean;
  status: DocumentStatus | null;
  locked: boolean;
} & Panels & Clients) {
  const { mode, setMode, canShowVisual } = useEditorMode();
  const sync = useSyncStatus();
  const source = useSourceText();
  // Here rather than in the header, which Source mode unmounts.
  const frontmatter = useFrontmatter(source.value, source.onChange);
  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const [field, setField] = useState<FieldReveal | null>(null);
  const editor = useRef<HTMLElement>(null);
  useEditorPlugin(editor, decorations);
  const completion = useMemo(() => assetCompletion(assets, notePath), [assets, notePath]);
  // Only once the server sent the note: before that (still opening, denied,
  // offline) the text is empty, and an empty note would pass as clean.
  const lintState = useLint(lint, files, notePath, opened ? source.value : null);
  // A request is for the Source on screen now; a later Source starts fresh.
  if (mode !== 'source' && reveal !== null) setReveal(null);
  if (mode !== 'visual' && field !== null) setField(null);

  const issueTotal = lintState.issues?.length ?? null;
  const hasErrors = lintState.issues?.some((issue) => issue.severity === 'error') ?? false;
  useEffect(() => {
    onIssueCount(issueTotal === null ? null : { count: issueTotal, errors: hasErrors });
  }, [issueTotal, hasErrors, onIssueCount]);
  // No note, no count: the activity bar drops its badge.
  useEffect(() => () => { onIssueCount(null); }, [onIssueCount]);
  // An issue in the frontmatter opens its field in the header; any other
  // position is into the source text, so show it in Source.
  const showIssue = (issue: LintIssue) => {
    const path = canShowVisual ? frontmatterPathAt(source.value, issue.start.offset) : null;
    if (path !== null) {
      setMode('visual');
      setField((previous) => ({ path, seq: (previous?.seq ?? 0) + 1 }));
    } else {
      setMode('source');
      setReveal((previous) => ({ start: issue.start, end: issue.end, seq: (previous?.seq ?? 0) + 1 }));
    }
    onIssueShown();
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section ref={editor} aria-label="Editor" className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--fde-background)]">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--fde-border)] px-4 py-2">
          <SaveStatus status={status} />
          <UploadNotice notice={uploads.notice} onDismiss={uploads.dismissNotice} />
          <IssuesChip state={lintState} onOpen={onShowIssues} />
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
              <NoteHeader
                frontmatter={frontmatter}
                readOnly={source.readOnly || locked}
                onOpenSource={() => { setMode('source'); }}
                onLeave={() => { focusBody(editor.current); }}
                reveal={field}
              />
              <MdxEditor.Visual className="studio-prose" />
              <GraphTools container={editor} />
            </div>
          </div>
        ) : (
          <SourceEditor reveal={reveal} completion={completion} />
        )}
      </section>
      {issuesSlot && createPortal(<IssuesPanel state={lintState} onSelect={showIssue} />, issuesSlot)}
      {uploads.dialog}
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

// The body below the header: the static preview until the editor is live
// (a key there starts it), then the editor itself.
function focusBody(root: HTMLElement | null) {
  const body = root?.querySelector('.studio-prose');
  const target = body?.querySelector<HTMLElement>(':scope > [tabindex="0"]') ?? body?.querySelector<HTMLElement>('[contenteditable="true"]');
  target?.focus();
}
