import { Braces, Copy, FileText, Frame, Plus, Redo2, StickyNote, Trash2, Undo2, Workflow } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { laysItselfOut } from '@site/lib/diagram/schema';
import { DIAGRAM_SUFFIX, DIAGRAMS_DIR } from '@site/lib/diagram/source';
import type { AssetUsage } from '../api/assets';
import type { createFilesClient } from '../api/files';
import { plural } from '../assets/asset-changes';
import { DiagramCanvas, type Drawn, type Selection } from './DiagramCanvas';
import { DiagramJson } from './DiagramJson';
import { JsonSplit } from './JsonSplit';
import { SPLIT_MIN, useJsonHeight } from './useJsonHeight';
import { DiagramPanel } from './DiagramPanel';
import { LifecycleCanvas } from './LifecycleCanvas';
import { SequenceCanvas } from './SequenceCanvas';
import { legendBand, placeCopy } from './placement';
import {
  addCard,
  addGroup,
  addNodeAt,
  addParticipant,
  addState,
  duplicateCard,
  duplicateGroup,
  duplicateNodes,
  freeSpot,
  GRID,
  moveMessage,
  moveNodes,
  moveParticipant,
  removeCard,
  removeEdge,
  removeGroup,
  removeNodes,
  type Input,
} from './edits';
import { useDiagramFile, type SaveStatus } from './useDiagramFile';
import '@site/styles/diagram.css';

const STATUS: Record<SaveStatus, string> = {
  loading: 'Loading…',
  saved: 'Saved',
  unsaved: 'Unsaved',
  saving: 'Saving…',
  invalid: 'Not valid JSON',
  conflict: 'Changed on disk',
  failed: 'Could not save',
};

// The `src` a <Diagram> names the file with (lib/diagram/source.ts, the other way).
const srcOf = (path: string) => path.slice(DIAGRAMS_DIR.length + 1, -DIAGRAM_SUFFIX.length);

// Whether a key press belongs to a field (or the JSON view) rather than the canvas.
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.closest('.cm-editor') !== null);

// The selection with what no longer exists dropped (after an undo, the JSON
// view or a change on disk).
function existing(doc: Input, selection: Selection): Selection {
  if (selection?.type === 'nodes') {
    const ids = selection.ids.filter((id) => doc.nodes.some((node) => node.id === id));
    return ids.length ? (ids.length === selection.ids.length ? selection : { type: 'nodes', ids }) : null;
  }
  if (selection?.type === 'edge') return (doc.edges ?? []).some((edge) => edge.id === selection.id) ? selection : null;
  if (selection?.type === 'group') return (doc.groups ?? []).some((group) => group.id === selection.id) ? selection : null;
  if (selection?.type === 'card') return doc.cards?.[selection.index] ? selection : null;
  return null;
}

// The main pane for a `diagrams/**/*.diagram.json`: the drawing to edit by
// hand, its JSON beside it on demand, the properties of what is selected,
// the checks' findings and the notes that draw it. Edits save on their own,
// as a note's do; `readOnly` (main, or a reader) only shows.
// `onWaiting` hears whether edits are not on disk yet, so the App waits for
// them as for a note's (switching change request, renaming, committing).
export function DiagramPage({ files, path, readOnly, usages, onOpenUsage, onWaiting }: {
  files: ReturnType<typeof createFilesClient>;
  path: string;
  readOnly: boolean;
  usages: AssetUsage[] | null;
  onOpenUsage: (usage: AssetUsage) => void;
  onWaiting?: (waiting: boolean) => void;
}) {
  const file = useDiagramFile(files, path, readOnly);
  const [chosen, setSelection] = useState<Selection>(null);
  const [json, setJson] = useState(false);
  // A file that is not JSON opens in the JSON view, which stays open once it parses.
  if (!file.doc && file.status === 'invalid' && !json) setJson(true);
  const { waiting } = file;
  useEffect(() => { onWaiting?.(waiting); }, [waiting, onWaiting]);
  useEffect(() => () => { onWaiting?.(false); }, [onWaiting]);
  const [drawn, setDrawn] = useState<Drawn>({ scene: null, issues: [] });
  const split = useJsonHeight();
  const column = useRef<HTMLDivElement>(null);
  const { doc, apply, undo, redo } = file;
  const selection = doc ? existing(doc, chosen) : null;
  // A sequence is laid out from its order, a lifecycle from its main path
  // and transitions: no positions, frames or copies.
  const sequence = doc?.type === 'sequence';
  const lifecycle = doc?.type === 'lifecycle';
  const structural = laysItselfOut(doc?.type);
  const nodes = useMemo(() => (selection?.type === 'nodes' ? selection.ids : []), [selection]);

  const remove = useCallback(() => {
    if (!doc || !selection) return;
    if (selection.type === 'nodes' && nodes.length < doc.nodes.length) apply(removeNodes(doc, nodes));
    else if (selection.type === 'edge') apply(removeEdge(doc, selection.id));
    else if (selection.type === 'group') apply(removeGroup(doc, selection.id));
    else if (selection.type === 'card') apply(removeCard(doc, selection.index));
    else return;
    setSelection(null);
  }, [doc, selection, nodes, apply]);

  const { scene } = drawn;
  const duplicate = useCallback(() => {
    // A sequence or lifecycle copies only its cards (the button says so too).
    if (!doc || !selection || (structural && selection.type !== 'card')) return;
    if (selection.type === 'nodes') {
      if (!scene) return;
      const made = duplicateNodes(doc, nodes, placeCopy(doc, scene, { nodes }));
      apply(made.diagram);
      setSelection({ type: 'nodes', ids: made.ids });
    } else if (selection.type === 'group') {
      if (!scene) return;
      const made = duplicateGroup(doc, selection.id, placeCopy(doc, scene, { group: selection.id }));
      apply(made.diagram);
      setSelection({ type: 'group', id: made.id });
    } else if (selection.type === 'card') {
      apply(duplicateCard(doc, selection.index));
      setSelection({ type: 'card', index: selection.index + 1 });
    }
  }, [doc, scene, selection, nodes, apply, structural]);

  // Keys act while the focus is on the page (the canvas takes it on a
  // click), not in its fields or elsewhere in the Studio.
  const onKey = (event: ReactKeyboardEvent) => {
      if (typing(event.target) || !doc) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === 'z') (event.shiftKey ? redo : undo)();
      else if (mod && key === 'y') redo();
      else if (mod && key === 'd') duplicate();
      else if (!mod && (event.key === 'Delete' || event.key === 'Backspace')) remove();
      else if (event.key === 'Escape') setSelection(null);
      else if (sequence && event.key.startsWith('Arrow') && !readOnly) {
        // The arrows move a participant a column, a message a step in the timeline.
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }[event.key] ?? 0;
        const sideways = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
        if (sideways && nodes.length === 1) {
          const index = doc.nodes.findIndex((node) => node.id === nodes[0]);
          if (index + step < 0 || index + step >= doc.nodes.length) return;
          apply(moveParticipant(doc, nodes[0], index + step));
        } else if (!sideways && selection?.type === 'edge') {
          const edges = doc.edges ?? [];
          const index = edges.findIndex((edge) => edge.id === selection.id);
          if (index + step < 0 || index + step >= edges.length) return;
          apply(moveMessage(doc, selection.id, index + step));
        } else return;
      } else if (event.key.startsWith('Arrow') && nodes.length && !readOnly && !lifecycle) {
        const step = event.shiftKey ? 4 * GRID : GRID;
        const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key] ?? [0, 0];
        apply(moveNodes(doc, nodes, dx, dy));
      } else return;
      event.preventDefault();
  };

  const issues = drawn.issues;
  const errors = issues.filter((issue) => issue.severity === 'error');
  const canDelete = selection !== null && !(selection.type === 'nodes' && doc !== null && nodes.length >= doc.nodes.length);

  return (
    <main className="studio-dg-page" aria-label={`Diagram ${path}`} onKeyDown={onKey}>
      <div className="studio-dg-bar">
        <Workflow size={16} aria-hidden />
        <span className="studio-dg-path" title={path}>{path}</span>
        <span className="studio-dg-status" role="status" data-status={file.status}>{readOnly ? 'Read only' : STATUS[file.status]}</span>
        {issues.length > 0 && (
          <span className="studio-dg-count" data-error={errors.length > 0 || undefined}>{plural(issues.length, 'issue')}</span>
        )}
        <span className="flex-1" />
        {!readOnly && doc && (
          <div className="studio-dg-tools" role="toolbar" aria-label="Diagram tools">
            <button type="button" className="studio-icon-button" title={sequence ? 'Add a participant' : lifecycle ? 'Add a state' : 'Add a node'} aria-label={sequence ? 'Add a participant' : lifecycle ? 'Add a state' : 'Add a node'} onClick={() => {
              if (structural) {
                const made = sequence ? addParticipant(doc) : addState(doc);
                apply(made.diagram);
                setSelection({ type: 'nodes', ids: [made.id] });
                return;
              }
              const spot = scene ? freeSpot([...scene.nodes, ...scene.frames, ...(scene.legend ? [legendBand(scene)] : [])], scene.width, scene.height) : { x: 40, y: 40 };
              const made = addNodeAt(doc, spot);
              apply(made.diagram);
              setSelection({ type: 'nodes', ids: [made.id] });
            }}><Plus size={16} /></button>
            {!structural && <button type="button" className="studio-icon-button" title="Wrap the selected nodes in a frame" aria-label="Add a frame" disabled={nodes.length === 0} onClick={() => {
              const made = addGroup(doc, nodes);
              apply(made.diagram);
              setSelection({ type: 'group', id: made.id });
            }}><Frame size={16} /></button>}
            <button type="button" className="studio-icon-button" title="Add a card" aria-label="Add a card" onClick={() => {
              apply(addCard(doc));
              setSelection({ type: 'card', index: doc.cards?.length ?? 0 });
            }}><StickyNote size={16} /></button>
            <button type="button" className="studio-icon-button" title="Duplicate (⌘D)" aria-label="Duplicate" disabled={!selection || selection.type === 'edge' || (structural && selection.type !== 'card')} onClick={duplicate}><Copy size={16} /></button>
            <button type="button" className="studio-icon-button" title="Delete (Delete)" aria-label="Delete" disabled={!canDelete} onClick={remove}><Trash2 size={16} /></button>
            <span className="studio-dg-sep" />
            <button type="button" className="studio-icon-button" title="Undo (⌘Z)" aria-label="Undo" disabled={!file.canUndo} onClick={undo}><Undo2 size={16} /></button>
            <button type="button" className="studio-icon-button" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!file.canRedo} onClick={redo}><Redo2 size={16} /></button>
          </div>
        )}
        <button type="button" className="studio-button" aria-pressed={json} onClick={() => { setJson(!json); }}>
          <Braces size={14} aria-hidden /> JSON
        </button>
      </div>
      {file.status === 'conflict' && (
        <div role="alert" className="studio-dg-conflict">
          <span>{file.disk?.content === null ? 'This diagram is gone from disk (or could not be read). Keep mine writes it again.' : 'This diagram changed on disk while your last edits were not saved.'}</span>
          {file.disk?.content !== null && <button type="button" className="studio-button" onClick={() => { file.resolve('disk'); }}>Load from disk</button>}
          <button type="button" className="studio-button" onClick={() => { file.resolve('mine'); }}>Keep mine</button>
        </div>
      )}
      {file.error !== null && <p role="alert" className="studio-dg-error">{file.status === 'failed' && !doc ? 'Could not open the diagram: ' : 'Could not save: '}{file.error}</p>}
      {(doc !== null || file.status === 'invalid') && (
        <div className="studio-dg-body" data-json={json || undefined} data-only-json={!doc || undefined}>
          <div className="studio-dg-left" ref={column}>
          {doc && <div className="studio-dg-main">
            {sequence
              ? <SequenceCanvas doc={doc} readOnly={readOnly} selection={selection} onSelect={setSelection} onChange={apply} onDrawn={setDrawn} />
              : lifecycle
                ? <LifecycleCanvas doc={doc} readOnly={readOnly} selection={selection} onSelect={setSelection} onChange={apply} onDrawn={setDrawn} />
                : <DiagramCanvas doc={doc} readOnly={readOnly} selection={selection} onSelect={setSelection} onChange={apply} onDrawn={setDrawn} />}
            {issues.length > 0 && (
              <details className="studio-dg-issues" open={errors.length > 0}>
                <summary>{plural(issues.length, 'issue')} from the checks</summary>
                <ul>
                  {issues.map((issue, index) => (
                    <li key={index} data-severity={issue.severity}>
                      <code>{issue.code}</code> {issue.message}{issue.fix ? ` Fix: ${issue.fix}.` : ''}{issue.path ? <span className="studio-dg-muted"> ({issue.path})</span> : null}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <section className="studio-dg-usages" aria-label="Used in">
              <h3>Used in</h3>
              {usages === null ? (
                <p className="studio-dg-muted">Looking for the notes that draw it…</p>
              ) : usages.length === 0 ? (
                <p className="studio-dg-muted">No note draws it yet. Add <code>{`<Diagram src="${srcOf(path)}" />`}</code> to one.</p>
              ) : (
                <ul>
                  {usages.map((usage) => (
                    <li key={`${usage.note}:${String(usage.line)}`}>
                      <button type="button" onClick={() => { onOpenUsage(usage); }}>
                        <FileText size={13} aria-hidden /> {usage.note.replace(/^content\/notes\//, '')}:{usage.line}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>}
          {json && doc && <JsonSplit height={split.height} onResize={split.set} column={() => column.current} />}
          {json && (
            <div className="studio-dg-json-pane" style={doc && split.height !== null ? { flex: 'none', height: split.height, maxHeight: `calc(100% - ${String(SPLIT_MIN)}px)` } : undefined}>
              <DiagramJson value={file.text} onChange={file.setText} readOnly={readOnly} invalid={file.status === 'invalid'} />
            </div>
          )}
          </div>
          {doc && <DiagramPanel doc={doc} selection={selection} onSelect={setSelection} onChange={apply} readOnly={readOnly} />}
        </div>
      )}
    </main>
  );
}
