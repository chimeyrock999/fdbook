import { EDGE_VARIANTS, ICONS, SIDES, TONES, type Side } from '@site/lib/diagram/schema';
import { Plus, Trash2 } from 'lucide-react';
import type { Selection } from './DiagramCanvas';
import { Check, Choice, Section, TextField } from './panel-fields';
import { ActivationsFields, MessageOrderFields, ParticipantOrderFields, SegmentsFields } from './SequencePanel';
import {
  addKind,
  removeKind,
  setEdgeSides,
  setWaypoints,
  updateCard,
  updateEdge,
  updateGroup,
  updateKind,
  updateNode,
  type Input,
  type KindInput,
  type NodeInput,
} from './edits';

// The Kind choice that makes a new kind for the node.
const NEW_KIND = '__new-kind';

type Change = (next: Input) => void;

const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);

// A kind's legend name, tone and icon: every node of the kind follows.
function KindFields({ doc, kind, onChange, readOnly, every }: { doc: Input; kind: KindInput; onChange: Change; readOnly: boolean; every?: boolean }) {
  const set = (patch: Partial<KindInput>) => { onChange(updateKind(doc, kind.id, patch)); };
  const of = every ? ` of every ${kind.label}` : '';
  return (
    <>
      <TextField label={every ? `Name of every ${kind.label}` : 'Name'} value={kind.label} readOnly={readOnly} hint={every ? 'As the legend says it.' : undefined} onCommit={(label) => { if (label.trim()) set({ label }); }} />
      <Choice label={`Tone${of}`} value={kind.tone} readOnly={readOnly} options={TONES} onChange={(tone) => { if (tone) set({ tone }); }} />
      <Choice label={`Icon${of}`} value={kind.icon} readOnly={readOnly} options={ICONS} none="dot (default)" onChange={(icon) => { set({ icon }); }} />
    </>
  );
}

// Every kind the diagram lists, each with how many nodes are of it; one no
// node is of can go.
function KindsFields({ doc, onChange, readOnly }: { doc: Input; onChange: Change; readOnly: boolean }) {
  return (
    <Section title="Kinds">
      {doc.kinds.map((kind) => {
        const count = doc.nodes.filter((node) => node.kind === kind.id).length;
        return (
          <div key={kind.id} className="studio-dg-kind" aria-label={`Kind ${kind.label}`} role="group">
            <div className="studio-dg-kind-head">
              <code>{kind.id}</code>
              <span className="studio-dg-muted">{count === 0 ? 'unused' : `${String(count)} node${count === 1 ? '' : 's'}`}</span>
              {!readOnly && (
                <button
                  type="button"
                  className="studio-icon-button"
                  aria-label={`Remove the kind ${kind.label}`}
                  title={count > 0 ? 'Nodes are of this kind: give them another first' : 'Remove the kind'}
                  disabled={count > 0 || doc.kinds.length <= 1}
                  onClick={() => { onChange(removeKind(doc, kind.id)); }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <KindFields doc={doc} kind={kind} onChange={onChange} readOnly={readOnly} />
          </div>
        );
      })}
      {!readOnly && (
        <button type="button" className="studio-button" onClick={() => { onChange(addKind(doc).diagram); }}>
          <Plus size={14} aria-hidden /> Add a kind
        </button>
      )}
    </Section>
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
  const sequence = doc.type === 'sequence';
  return (
    <>
      <Section title={`${sequence ? 'Participant' : 'Node'} ${node.id}`}>
        <TextField label="Label" value={node.label} readOnly={readOnly} onCommit={(label) => { if (label.trim()) set({ label }); }} />
        <TextField label="Sublabel" value={node.sublabel ?? ''} readOnly={readOnly} onCommit={(sublabel) => { set({ sublabel: sublabel.trim() || undefined }); }} />
        {(!sequence || node.tag) && <TextField label="Tag" value={node.tag ?? ''} readOnly={readOnly} hint={sequence ? 'A participant box does not show it.' : undefined} onCommit={(tag) => { set({ tag: tag.trim() || undefined }); }} />}
        <Choice
          label="Kind"
          value={node.kind}
          readOnly={readOnly}
          options={[...doc.kinds.map((each) => ({ value: each.id, label: each.label })), ...(readOnly ? [] : [{ value: NEW_KIND, label: 'New kind…' }])]}
          onChange={(value) => {
            if (value === NEW_KIND) onChange(addKind(doc, node.id).diagram);
            else if (value) set({ kind: value });
          }}
        />
      </Section>
      {sequence && <ParticipantOrderFields doc={doc} id={node.id} onChange={onChange} readOnly={readOnly} />}
      {kind && (
        <Section title={`Kind ${kind.label}`}>
          <KindFields doc={doc} kind={kind} onChange={onChange} readOnly={readOnly} every />
        </Section>
      )}
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
  const layout = doc.layout?.edges?.[id];
  const set = (patch: Parameters<typeof updateEdge>[2]) => { onChange(updateEdge(doc, id, patch)); };
  const side = (key: 'fromSide' | 'toSide') => (value: Side | undefined) => { onChange(setEdgeSides(doc, id, { ...layout, [key]: value })); };
  if (doc.type === 'sequence') {
    return (
      <>
        <Section title={`Message ${edge.from} → ${edge.to}`}>
          <TextField label="Label" value={edge.label ?? ''} readOnly={readOnly} onCommit={(label) => { if (label.trim()) set({ label }); }} />
          <TextField label="Note" value={edge.detail ?? ''} readOnly={readOnly} hint="Small text under the arrow." onCommit={(detail) => { set({ detail: detail.trim() || undefined }); }} />
          <Choice label="Variant" value={edge.variant ?? 'default'} readOnly={readOnly} options={EDGE_VARIANTS} onChange={(variant) => { set({ variant: variant === 'default' ? undefined : variant }); }} />
        </Section>
        <MessageOrderFields doc={doc} id={id} onChange={onChange} readOnly={readOnly} />
      </>
    );
  }
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
      <KindsFields doc={doc} onChange={onChange} readOnly={readOnly} />
      {doc.type === 'sequence' && (
        <>
          <SegmentsFields doc={doc} onChange={onChange} readOnly={readOnly} />
          <ActivationsFields doc={doc} onChange={onChange} readOnly={readOnly} />
        </>
      )}
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
      <p className="studio-dg-muted">{doc.type === 'sequence'
        ? 'Click a participant or a message to edit it. Drag from the handle under a lifeline to another lifeline to add a message.'
        : 'Click a node, an edge or a frame to edit it. Double click the canvas to add a node.'}</p>
    </div>
  );
}
