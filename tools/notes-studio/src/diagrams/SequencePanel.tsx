import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { moveMessage, moveParticipant, updateEdge, type Input } from './edits';
import { Choice, Section, TextField } from './panel-fields';

// The panel parts only a sequence has: where a participant or a message
// sits in the order (which is its layout), and the segments and
// activations, each naming its first and last message.

type Change = (next: Input) => void;
type Range = { from: string; to: string };

function OrderButtons({ index, count, onMove, readOnly, labels: [before, after], vertical }: {
  index: number;
  count: number;
  onMove: (index: number) => void;
  readOnly: boolean;
  labels: [string, string];
  vertical: boolean;
}) {
  const [Back, Forward] = vertical ? [ArrowUp, ArrowDown] : [ArrowLeft, ArrowRight];
  return (
    <div className="studio-dg-order">
      <button type="button" className="studio-button" disabled={readOnly || index === 0} onClick={() => { onMove(index - 1); }}>
        <Back size={14} aria-hidden /> {before}
      </button>
      <button type="button" className="studio-button" disabled={readOnly || index >= count - 1} onClick={() => { onMove(index + 1); }}>
        <Forward size={14} aria-hidden /> {after}
      </button>
    </div>
  );
}

export function ParticipantOrderFields({ doc, id, onChange, readOnly }: { doc: Input; id: string; onChange: Change; readOnly: boolean }) {
  const index = doc.nodes.findIndex((node) => node.id === id);
  return (
    <Section title={`Column ${String(index + 1)} of ${String(doc.nodes.length)}`}>
      <OrderButtons index={index} count={doc.nodes.length} readOnly={readOnly} vertical={false} labels={['Left', 'Right']} onMove={(to) => { onChange(moveParticipant(doc, id, to)); }} />
      <p className="studio-dg-muted">Or drag its header sideways.</p>
    </Section>
  );
}

export function MessageOrderFields({ doc, id, onChange, readOnly }: { doc: Input; id: string; onChange: Change; readOnly: boolean }) {
  const edges = doc.edges ?? [];
  const index = edges.findIndex((edge) => edge.id === id);
  const edge = edges.find((each) => each.id === id);
  if (!edge) return null;
  const participants = doc.nodes.map((node) => ({ value: node.id, label: node.label }));
  // A message goes between two participants: an end that would meet the other is refused.
  const end = (key: 'from' | 'to') => (value: string | undefined) => {
    if (value && value !== (key === 'from' ? edge.to : edge.from)) onChange(updateEdge(doc, id, { [key]: value }));
  };
  return (
    <Section title={`Message ${String(index + 1)} of ${String(edges.length)}`}>
      <Choice label="From" value={edge.from} options={participants} readOnly={readOnly} onChange={end('from')} />
      <Choice label="To" value={edge.to} options={participants} readOnly={readOnly} onChange={end('to')} />
      <OrderButtons index={index} count={edges.length} readOnly={readOnly} vertical labels={['Earlier', 'Later']} onMove={(to) => { onChange(moveMessage(doc, id, to)); }} />
      <p className="studio-dg-muted">Or drag its grip up or down.</p>
    </Section>
  );
}

// A copy of `doc` with `key` set to `list`, or without it when empty.
function withList(doc: Input, key: 'segments' | 'activations', list: unknown[]): Input {
  const next = structuredClone(doc);
  if (key === 'segments') next.segments = list as Input['segments'];
  else next.activations = list as Input['activations'];
  if (!list.length) {
    if (key === 'segments') delete next.segments;
    else delete next.activations;
  }
  return next;
}

function RangeFields({ doc, range, onChange, readOnly }: { doc: Input; range: Range; onChange: (range: Range) => void; readOnly: boolean }) {
  const messages = (doc.edges ?? []).map((edge, index) => ({ value: edge.id, label: `${String(index + 1)}. ${edge.label ?? edge.id}` }));
  return (
    <>
      <Choice label="From message" value={range.from} options={messages} readOnly={readOnly} onChange={(from) => { if (from) onChange({ ...range, from }); }} />
      <Choice label="To message" value={range.to} options={messages} readOnly={readOnly} onChange={(to) => { if (to) onChange({ ...range, to }); }} />
    </>
  );
}

export function SegmentsFields({ doc, onChange, readOnly }: { doc: Input; onChange: Change; readOnly: boolean }) {
  const segments = doc.segments ?? [];
  const last = (doc.edges ?? []).at(-1);
  const set = (index: number, segment: (typeof segments)[number] | null) => {
    onChange(withList(doc, 'segments', segment ? segments.map((each, at) => (at === index ? segment : each)) : segments.filter((_, at) => at !== index)));
  };
  return (
    <Section title="Segments">
      {segments.length === 0 && <p className="studio-dg-muted">No segments. A segment frames a phase of the timeline.</p>}
      {segments.map((segment, index) => (
        <div key={index} className="studio-dg-kind" role="group" aria-label={`Segment ${segment.label}`}>
          <div className="studio-dg-kind-head">
            <span>{segment.label}</span>
            {!readOnly && <button type="button" className="studio-icon-button" aria-label={`Remove the segment ${segment.label}`} onClick={() => { set(index, null); }}><Trash2 size={14} /></button>}
          </div>
          <TextField label="Title" value={segment.label} readOnly={readOnly} onCommit={(label) => { if (label.trim()) set(index, { ...segment, label }); }} />
          <RangeFields doc={doc} range={segment} readOnly={readOnly} onChange={(range) => { set(index, { ...segment, ...range }); }} />
        </div>
      ))}
      {!readOnly && last && (
        <button type="button" className="studio-button" onClick={() => { onChange(withList(doc, 'segments', [...segments, { label: 'Phase', from: last.id, to: last.id }])); }}>
          <Plus size={14} aria-hidden /> Add a segment
        </button>
      )}
    </Section>
  );
}

export function ActivationsFields({ doc, onChange, readOnly }: { doc: Input; onChange: Change; readOnly: boolean }) {
  const activations = doc.activations ?? [];
  const edges = doc.edges ?? [];
  const participants = doc.nodes.map((node) => ({ value: node.id, label: node.label }));
  const set = (index: number, activation: (typeof activations)[number] | null) => {
    onChange(withList(doc, 'activations', activation ? activations.map((each, at) => (at === index ? activation : each)) : activations.filter((_, at) => at !== index)));
  };
  return (
    <Section title="Activations">
      {activations.length === 0 && <p className="studio-dg-muted">No activations. One shows a participant busy across messages.</p>}
      {activations.map((activation, index) => (
        <div key={index} className="studio-dg-kind" role="group" aria-label={`Activation of ${activation.node}`}>
          <div className="studio-dg-kind-head">
            <code>{activation.node}</code>
            {!readOnly && <button type="button" className="studio-icon-button" aria-label={`Remove the activation of ${activation.node}`} onClick={() => { set(index, null); }}><Trash2 size={14} /></button>}
          </div>
          <Choice label="Participant" value={activation.node} options={participants} readOnly={readOnly} onChange={(node) => { if (node) set(index, { ...activation, node }); }} />
          <RangeFields doc={doc} range={activation} readOnly={readOnly} onChange={(range) => { set(index, { ...activation, ...range }); }} />
        </div>
      ))}
      {!readOnly && edges.length > 0 && (
        <button type="button" className="studio-button" onClick={() => { onChange(withList(doc, 'activations', [...activations, { node: edges[0].to, from: edges[0].id, to: edges[0].id }])); }}>
          <Plus size={14} aria-hidden /> Add an activation
        </button>
      )}
    </Section>
  );
}
