import { EDGE_VARIANTS, ICONS, SIDES, TONES, type Side } from '@site/lib/diagram/schema';
import { useState, type ReactNode } from 'react';
import type { Selection } from './DiagramCanvas';
import {
  setEdgeSides,
  setWaypoints,
  updateCard,
  updateEdge,
  updateGroup,
  updateKind,
  updateNode,
  type Input,
  type NodeInput,
} from './edits';

type Change = (next: Input) => void;

const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);

// A text field that changes the diagram once it is left or Enter is
// pressed, so one edit is one undo step. A change from elsewhere (undo, the
// JSON view, an agent) shows as soon as the field is not being edited.
function TextField({ label, value, onCommit, multiline = false, readOnly, hint }: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
  readOnly: boolean;
  hint?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  const props = {
    className: 'studio-input',
    value: draft ?? value,
    readOnly,
    onChange: (event: { target: { value: string } }) => { setDraft(event.target.value); },
    onBlur: commit,
  };
  return (
    <label className="studio-dg-field">
      <span>{label}</span>
      {multiline ? (
        <textarea {...props} rows={3} />
      ) : (
        <input {...props} onKeyDown={(event) => { if (event.key === 'Enter') commit(); else if (event.key === 'Escape') setDraft(null); }} />
      )}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Choice<T extends string>({ label, value, options, onChange, readOnly, none }: {
  label: string;
  value: T | undefined;
  options: readonly T[] | readonly { value: T; label: string }[];
  onChange: (value: T | undefined) => void;
  readOnly: boolean;
  // The empty choice's label; without one there is none.
  none?: string;
}) {
  const items = options.map((option) => (typeof option === 'string' ? { value: option, label: option } : option));
  return (
    <label className="studio-dg-field">
      <span>{label}</span>
      <select className="studio-input" value={value ?? ''} disabled={readOnly} onChange={(event) => { onChange(event.target.value === '' ? undefined : (event.target.value as T)); }}>
        {none !== undefined && <option value="">{none}</option>}
        {items.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </label>
  );
}

function Check({ label, checked, onChange, readOnly }: { label: string; checked: boolean; onChange: (checked: boolean) => void; readOnly: boolean }) {
  return (
    <label className="studio-dg-check">
      <input type="checkbox" checked={checked} disabled={readOnly} onChange={(event) => { onChange(event.target.checked); }} />
      {label}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="studio-dg-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function NodeFields({ doc, node, onChange, readOnly }: { doc: Input; node: NodeInput; onChange: Change; readOnly: boolean }) {
  const kind = doc.kinds.find((each) => each.id === node.kind);
  const set = (patch: Partial<NodeInput>) => { onChange(updateNode(doc, node.id, patch)); };
  const note = node.note;
  // A note needs its role: the evidence and the points wait for one.
  const setNote = (patch: Partial<NonNullable<NodeInput['note']>>) => {
    const next = { ...note, ...patch };
    if (!next.role) set({ note: undefined });
    else set({ note: { role: next.role, ...(next.badge ? { badge: next.badge } : {}), ...(next.points?.length ? { points: next.points } : {}) } });
  };
  return (
    <>
      <Section title={`Node ${node.id}`}>
        <TextField label="Label" value={node.label} readOnly={readOnly} onCommit={(label) => { if (label.trim()) set({ label }); }} />
        <TextField label="Sublabel" value={node.sublabel ?? ''} readOnly={readOnly} onCommit={(sublabel) => { set({ sublabel: sublabel.trim() || undefined }); }} />
        <TextField label="Tag" value={node.tag ?? ''} readOnly={readOnly} onCommit={(tag) => { set({ tag: tag.trim() || undefined }); }} />
        <Choice label="Kind" value={node.kind} readOnly={readOnly} options={doc.kinds.map((each) => ({ value: each.id, label: each.label }))} onChange={(value) => { if (value) set({ kind: value }); }} />
        {kind && (
          <Choice
            label={`Icon of every ${kind.label}`}
            value={kind.icon}
            readOnly={readOnly}
            options={ICONS}
            none="dot (default)"
            onChange={(icon) => { onChange(updateKind(doc, kind.id, { icon })); }}
          />
        )}
      </Section>
      <Section title="Note">
        <TextField label="Role" multiline value={note?.role ?? ''} readOnly={readOnly} hint="What the node does. MDX; empty removes the note." onCommit={(role) => { setNote({ role: role.trim() }); }} />
        {note && (
          <>
            <Choice
              label="Evidence"
              value={note.badge}
              readOnly={readOnly || (doc.badges ?? []).length === 0}
              options={(doc.badges ?? []).map((badge) => ({ value: badge.id, label: badge.label }))}
              none="None"
              onChange={(badge) => { setNote({ badge }); }}
            />
            <TextField label="Points" multiline value={(note.points ?? []).join('\n')} readOnly={readOnly} hint="One per line." onCommit={(text) => { setNote({ points: lines(text) }); }} />
          </>
        )}
      </Section>
    </>
  );
}

function EdgeFields({ doc, id, onChange, readOnly }: { doc: Input; id: string; onChange: Change; readOnly: boolean }) {
  const edge = (doc.edges ?? []).find((each) => each.id === id);
  if (!edge) return null;
  const layout = doc.layout.edges?.[id];
  const set = (patch: Parameters<typeof updateEdge>[2]) => { onChange(updateEdge(doc, id, patch)); };
  const side = (key: 'fromSide' | 'toSide') => (value: Side | undefined) => { onChange(setEdgeSides(doc, id, { ...layout, [key]: value })); };
  return (
    <Section title={`Edge ${edge.from} → ${edge.to}`}>
      <TextField label="Label" value={edge.label ?? ''} readOnly={readOnly} onCommit={(label) => { set({ label: label.trim() || undefined }); }} />
      <TextField label="Detail" value={edge.detail ?? ''} readOnly={readOnly} onCommit={(detail) => { set({ detail: detail.trim() || undefined }); }} />
      <Choice label="Variant" value={edge.variant ?? 'default'} readOnly={readOnly} options={EDGE_VARIANTS} onChange={(variant) => { set({ variant: variant === 'default' ? undefined : variant }); }} />
      <Check label="Arrow at both ends" checked={edge.bidirectional ?? false} readOnly={readOnly} onChange={(bidirectional) => { set({ bidirectional: bidirectional || undefined }); }} />
      <Choice label="Leaves from" value={layout?.fromSide} readOnly={readOnly} options={SIDES} none="auto" onChange={side('fromSide')} />
      <Choice label="Arrives at" value={layout?.toSide} readOnly={readOnly} options={SIDES} none="auto" onChange={side('toSide')} />
      {layout?.via && (
        <button type="button" className="studio-button" disabled={readOnly} onClick={() => { onChange(setWaypoints(doc, id, null)); }}>
          Route it again
        </button>
      )}
    </Section>
  );
}

function GroupFields({ doc, id, onChange, readOnly }: { doc: Input; id: string; onChange: Change; readOnly: boolean }) {
  const group = (doc.groups ?? []).find((each) => each.id === id);
  if (!group) return null;
  const set = (patch: Parameters<typeof updateGroup>[2]) => { onChange(updateGroup(doc, id, patch)); };
  return (
    <Section title={`Frame ${group.id}`}>
      <TextField label="Label" value={group.label} readOnly={readOnly} onCommit={(label) => { if (label.trim()) set({ label }); }} />
      <Choice label="Tone" value={group.tone ?? 'orange'} readOnly={readOnly} options={TONES} onChange={(tone) => { set({ tone: tone === 'orange' ? undefined : tone }); }} />
      <Check label="Dashed: a rule rather than a place" checked={group.dashed ?? false} readOnly={readOnly} onChange={(dashed) => { set({ dashed: dashed || undefined }); }} />
      <p className="studio-dg-muted">Holds {group.members.join(', ')}.</p>
    </Section>
  );
}

function CardFields({ doc, index, onChange, readOnly }: { doc: Input; index: number; onChange: Change; readOnly: boolean }) {
  const card = doc.cards?.[index];
  if (!card) return null;
  const set = (patch: Parameters<typeof updateCard>[2]) => { onChange(updateCard(doc, index, patch)); };
  return (
    <Section title={`Card ${String(index + 1)}`}>
      <TextField label="Title" value={card.title} readOnly={readOnly} onCommit={(title) => { if (title.trim()) set({ title }); }} />
      <Choice label="Tone" value={card.tone ?? 'blue'} readOnly={readOnly} options={TONES} onChange={(tone) => { set({ tone: tone === 'blue' ? undefined : tone }); }} />
      <TextField label="Items" multiline value={card.items.join('\n')} readOnly={readOnly} hint="One per line. MDX." onCommit={(text) => { if (lines(text).length) set({ items: lines(text) }); }} />
    </Section>
  );
}

// The properties of what is selected, or of the diagram (its title, the
// legend and the cards, which the drawing does not show) when nothing is.
export function DiagramPanel({ doc, selection, onSelect, onChange, readOnly }: {
  doc: Input;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onChange: Change;
  readOnly: boolean;
}) {
  if (selection?.type === 'nodes') {
    const nodes = selection.ids.map((id) => doc.nodes.find((node) => node.id === id)).filter((node) => node !== undefined);
    if (nodes.length === 1) return <div className="studio-dg-panel"><NodeFields key={nodes[0].id} doc={doc} node={nodes[0]} onChange={onChange} readOnly={readOnly} /></div>;
    if (nodes.length > 1) {
      return (
        <div className="studio-dg-panel">
          <Section title={`${String(nodes.length)} nodes`}>
            <p className="studio-dg-muted">{nodes.map((node) => node.label).join(', ')}. Drag one to move them all, or wrap them in a frame.</p>
          </Section>
        </div>
      );
    }
  }
  if (selection?.type === 'edge') return <div className="studio-dg-panel"><EdgeFields key={selection.id} doc={doc} id={selection.id} onChange={onChange} readOnly={readOnly} /></div>;
  if (selection?.type === 'group') return <div className="studio-dg-panel"><GroupFields key={selection.id} doc={doc} id={selection.id} onChange={onChange} readOnly={readOnly} /></div>;
  if (selection?.type === 'card') return <div className="studio-dg-panel"><CardFields key={selection.index} doc={doc} index={selection.index} onChange={onChange} readOnly={readOnly} /></div>;
  return (
    <div className="studio-dg-panel">
      <Section title="Diagram">
        <TextField label="Title" value={doc.title} readOnly={readOnly} onCommit={(title) => { if (title.trim()) onChange({ ...structuredClone(doc), title }); }} />
        <Check
          label="Show the legend"
          checked={doc.legend !== false}
          readOnly={readOnly}
          onChange={(legend) => {
            const next = structuredClone(doc);
            if (legend) delete next.legend;
            else next.legend = false;
            onChange(next);
          }}
        />
      </Section>
      <Section title="Cards">
        {(doc.cards ?? []).length === 0 && <p className="studio-dg-muted">No cards. They show under the drawing once it is expanded.</p>}
        <ul className="studio-dg-cards">
          {(doc.cards ?? []).map((card, index) => (
            <li key={index}>
              <button type="button" onClick={() => { onSelect({ type: 'card', index }); }}>{card.title}</button>
            </li>
          ))}
        </ul>
      </Section>
      <p className="studio-dg-muted">Click a node, an edge or a frame to edit it. Double click the canvas to add a node.</p>
    </div>
  );
}
