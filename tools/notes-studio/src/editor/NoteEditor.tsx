import type { DocumentStatus } from '@fumadocs-editor/core/sync';
import { MdxEditor, useEditorMode, useSourceText, useSyncStatus } from '@fumadocs-editor/ui';
import { observeAuthorFills } from '@site/lib/pele-author-fill';
import { History } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { createFilesClient } from '../api/files';
import type { LintClient, LintIssue } from '../api/lint';
import { confirmSignedIn } from '../api/session';
import { workspaceSyncClient } from '../api/sync';
import { frontmatterPathAt } from '../frontmatter/frontmatter';
import type { FieldReveal } from '../frontmatter/MetadataStrip';
import { useFrontmatter } from '../frontmatter/useFrontmatter';
import { IssuesChip, IssuesPanel } from '../lint/IssuesPanel';
import { useLint } from '../lint/useLint';
import { UploadNotice } from '../media/UploadNotice';
import { useAssetUploads } from '../media/useAssetUploads';
import { NOTES_PREFIX } from '../notes/notes';
import { useSession } from '../session/session';
import type { IssueCount } from '../sidebar/Sidebar';
import { assetCompletion } from './asset-completion';
import { createGraphSource } from '../graph/graph-plugin';
import { graphBubbleItems, GraphTools } from '../graph/GraphTools';
import { editorConfig } from '../plugins';
import { decorationsExtension } from './decorations';
import { pluginsExtension } from './extensions';
import { NoteHeader } from './NoteHeader';
import { createPlaceSource, useReportPlace } from './report-place';
import type { RevealRequest } from './reveal';
import { SourceEditor } from './SourceEditor';
import { ConflictDialog, SaveStatus } from './SyncState';
import { useUnsaved } from './unsaved';
import { UnsavedNotice } from './UnsavedNotice';
import { DeleteProposalBar } from '../suggestions/DeleteProposalBar';
import { NoteComments, SuggestionBar, VisualSuggestions, type NoteReview } from '../suggestions/Suggestions';
import { useNoteSuggestions } from '../suggestions/useNoteSuggestions';
import { sourceSuggestions } from '../suggestions/source';
import { createSuggestionLayer } from '../suggestions/visual';
import './drag-handle.css';

// The sidebar's Issues view: the editor fills `issuesSlot` and reports the
// count for the activity bar. `onShowIssues` opens the view (the issues
// chip); `onIssueShown` follows a picked issue, so a phone's drawer closes.
// `onShowHistory` opens the note's history in the main pane.
type Panels = {
  issuesSlot: HTMLElement | null;
  onIssueCount: (count: IssueCount) => void;
  onShowIssues: () => void;
  onIssueShown: () => void;
  onShowHistory: () => void;
};
type Clients = { files: ReturnType<typeof createFilesClient>; lint: LintClient };

// A place in the note to show in Source once it is open (a usage picked in
// the Assets view); a new `seq` shows it again.
export type SourcePlace = { line: number; column: number; length: number; seq: number };

// One note, open through the notes sync socket: autosave, live merge of
// changes made on disk, and the conflict choice when both sides edited the
// same block. `path` is relative to content/notes; the caller remounts this
// per path. The frontmatter is edited in the note header; the lint issues
// go to the sidebar's Issues view. Pasted, dropped and picked images are saved in the
// note's folder under public/notes, under a name asked for first; `assets`
// lists public/notes (useAssets), for the name check and Source. `onStatus`
// follows the autosave state, so a rename can wait for it. `place` is
// selected in Source once the note is open.
export function NoteEditor({ path, assets, onStatus, place = null, review = null, ...rest }: {
  path: string;
  assets: readonly string[];
  onStatus?: (status: DocumentStatus) => void;
  place?: SourcePlace | null;
  // The note's agent suggestions and comments (src/suggestions), in a change request.
  review?: NoteReview | null;
} & Panels & Clients) {
  const notePath = `${NOTES_PREFIX}${path}`;
  const uploads = useAssetUploads(rest.files, notePath, assets);
  // Whether the server takes edits: asked again on every reconnect, so a
  // writer turned reader locks (the server closes their connection). Null
  // until the note opened or was refused.
  const [writable, setWritable] = useState<boolean | null>(null);
  // The note as the server sent it when it opened; null until then.
  const [disk, setDisk] = useState<string | null>(null);
  const [status, setStatus] = useState<DocumentStatus | null>(null);
  const opened = disk !== null;
  const locked = writable === false || status === 'denied';
  const [parts] = useState(createParts);
  return (
    <MdxEditor.Root
      sync={{
        path,
        client: workspaceSyncClient(),
        onOpen: (result) => { setDisk(result.text); },
        onWritable: setWritable,
        onStatus: (next) => {
          setStatus(next);
          onStatus?.(next);
          // The server closes the socket of a session that ended (#115).
          if (next === 'offline') void confirmSignedIn();
        },
      }}
      components={editorConfig.components}
      syntax={editorConfig.syntax}
      media={uploads.media}
      extensions={parts.extensions}
      bubbleItems={graphBubbleItems}
      editable={!locked}
    >
      <EditorLayout
        parts={parts}
        path={path}
        notePath={notePath}
        disk={disk}
        assets={assets}
        uploads={uploads}
        opened={opened}
        status={!opened && status !== 'denied' && status !== 'offline' ? null : status}
        locked={locked}
        readOnly={opened && writable === false}
        place={place}
        review={review}
        {...rest}
      />
    </MdxEditor.Root>
  );
}

// The plugins' decorations, one ProseMirror plugin for every editor.
const decorations = decorationsExtension(editorConfig.decorators);

// What the Studio adds to one note's live editors, made with its root (which
// takes `extensions` once): the decorations, agent suggestions (#85), the
// graph tools, and where the person is, for the agent panel (#86).
function createParts() {
  const layer = createSuggestionLayer();
  const graph = createGraphSource();
  const place = createPlaceSource();
  return { layer, graph, place, extensions: [decorations, pluginsExtension('studioNote', [layer.plugin, graph.plugin, place.plugin])] };
}

type Parts = ReturnType<typeof createParts>;

function EditorLayout({ parts, path, notePath, disk, assets, uploads, opened, status, locked, readOnly, place, review, issuesSlot, onIssueCount, onShowIssues, onIssueShown, onShowHistory, files, lint }: {
  parts: Parts;
  path: string;
  notePath: string;
  disk: string | null;
  place: SourcePlace | null;
  review: NoteReview | null;
  assets: readonly string[];
  uploads: ReturnType<typeof useAssetUploads>;
  opened: boolean;
  status: DocumentStatus | null;
  locked: boolean;
  readOnly: boolean;
} & Panels & Clients) {
  const { mode, setMode, canShowVisual } = useEditorMode();
  const sync = useSyncStatus();
  const source = useSourceText();
  // Here rather than in the header, which Source mode unmounts.
  const frontmatter = useFrontmatter(source.value, source.onChange);
  // Unsaved text kept for a page that goes before the save (#121).
  const who = useSession().state.user?.login ?? '_';
  const unsaved = useUnsaved(who, path, { text: source.value, disk, status, setText: source.onChange });
  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const [field, setField] = useState<FieldReveal | null>(null);
  const editor = useRef<HTMLElement>(null);
  // Agent suggestions: placed on the text as it is now (#85).
  const suggestions = useNoteSuggestions(review, opened ? source.value : '');
  const { layer } = parts;
  // Where the person is, for the agent panel (#86).
  const onSourceSelect = useReportPlace(parts.place, notePath, source.value, opened);
  const canDecide = !locked && !source.readOnly;
  const { decide } = suggestions.decisions;
  // Source offers what can still be decided: a landing hunk is accepted.
  const { open: decidable } = suggestions;
  const sourceExtra = useMemo(() => (review === null || decidable.length === 0 ? null : sourceSuggestions(source.value, decidable, canDecide ? (hunk, op) => decide([hunk], op).then(() => undefined) : null)), [review, source.value, decidable, canDecide, decide]);
  const stepTo = (by: number) => {
    const key = suggestions.step(by);
    if (key !== undefined && mode === 'visual') layer.element(key, 'studio-suggest-card').scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  // The editor draws mermaid previews itself; mark the author's fills on
  // each one for the dark theme's label ink, as the site does.
  useEffect(() => (editor.current ? observeAuthorFills(editor.current) : undefined), []);
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
  // Only once the note is open: before that Source has no text to select in.
  const placeSeq = opened ? place?.seq : undefined;
  useEffect(() => {
    if (placeSeq === undefined || place === null) return;
    const { line, column, length } = place;
    setMode('source');
    // The note opens over the sync socket, after this renders: the place can
    // only be applied once it is there, so this follows `opened`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReveal((previous) => ({ start: { line, column }, end: { line, column: column + length }, seq: (previous?.seq ?? 0) + 1 }));
    // `placeSeq` stands for `place`, a new object on every render of App.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeSeq, setMode]);
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
      <section ref={editor} aria-label="Editor" className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--fde-background)]">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--fde-border)] px-4 py-2">
          <SaveStatus status={status} readOnly={readOnly} />
          <UploadNotice notice={uploads.notice} onDismiss={uploads.dismissNotice} />
          <IssuesChip state={lintState} onOpen={onShowIssues} />
          <span className="flex-1" />
          <button type="button" className="studio-button gap-1.5" onClick={onShowHistory}>
            <History size={13} aria-hidden /> History
          </button>
          <div role="tablist" aria-label="Mode" className="inline-flex rounded-lg border border-[var(--fde-border)] bg-[var(--fde-card)] p-0.5">
            <Tab selected={mode === 'visual'} disabled={!canShowVisual} onSelect={() => { setMode('visual'); }}>
              Visual
            </Tab>
            <Tab selected={mode === 'source'} onSelect={() => { setMode('source'); }}>
              Source
            </Tab>
          </div>
        </div>
        {review?.deletion != null && <DeleteProposalBar deletion={review.deletion} readOnly={!canDecide} />}
        {review !== null && opened && (
          <>
            <SuggestionBar placement={suggestions.placement} focus={suggestions.focus} onStep={stepTo} decisions={suggestions.decisions} />
            <NoteComments placement={suggestions.placement} readOnly={!canDecide} onResolve={review.resolveComment} />
          </>
        )}
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
              <MdxEditor.Visual className="studio-prose notes-prose" />
              {review !== null && <VisualSuggestions layer={layer} placement={suggestions.placement} focus={suggestions.focus} readOnly={!canDecide} decisions={suggestions.decisions} onResolveComment={review.resolveComment} />}
              <GraphTools container={editor} source={parts.graph} graph={frontmatter.status === 'ok' ? frontmatter.data.graph : undefined} />
            </div>
          </div>
        ) : (
          <SourceEditor reveal={reveal} completion={completion} extra={sourceExtra} onSelect={onSourceSelect} />
        )}
        {unsaved.offer && <UnsavedNotice offer={unsaved.offer} writable={!locked} onRestore={unsaved.restore} onDiscard={unsaved.discard} />}
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
