import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { mainPathGaps } from '@site/lib/diagram/validate-lifecycle';
import { setMainPath, type Input } from './edits';
import { Choice, Section } from './panel-fields';

// The panel parts only a lifecycle has: the main path, which the layout
// draws as its top row, and what a state is in it. The initial marker and
// the final border follow from the structure, so they are shown, not set.

type Change = (next: Input) => void;

export function MainPathFields({ doc, onChange, readOnly }: { doc: Input; onChange: Change; readOnly: boolean }) {
  const path = doc.mainPath ?? [];
  const label = (id: string) => doc.nodes.find((node) => node.id === id)?.label ?? id;
  // The steps the checks name in lifecycle/main-path-gap.
  const missing = mainPathGaps(doc).map((gap) => gap.to);
  const off = doc.nodes.filter((node) => !path.includes(node.id)).map((node) => ({ value: node.id, label: node.label }));
  return (
    <Section title="Main path">
      <ol className="studio-dg-path-list">
        {path.map((id, index) => (
          <li key={id}>
            <span>{label(id)}</span>
            {!readOnly && (
              <>
                <button type="button" className="studio-icon-button" aria-label={`Move ${label(id)} earlier`} disabled={index === 0} onClick={() => { onChange(setMainPath(doc, id, index - 1)); }}><ArrowUp size={13} /></button>
                <button type="button" className="studio-icon-button" aria-label={`Move ${label(id)} later`} disabled={index === path.length - 1} onClick={() => { onChange(setMainPath(doc, id, index + 1)); }}><ArrowDown size={13} /></button>
                <button type="button" className="studio-icon-button" aria-label={`Take ${label(id)} off the main path`} onClick={() => { onChange(setMainPath(doc, id, null)); }}><X size={13} /></button>
              </>
            )}
          </li>
        ))}
      </ol>
      {missing.length > 0 && (
        <p role="alert" className="studio-dg-path-gap">
          <code>lifecycle/main-path-gap</code> No transition into {missing.map(label).join(', ')} from the step before.
        </p>
      )}
      {!readOnly && off.length > 0 && (
        <Choice label="Add a state to the main path" value={undefined} options={off} none="Choose a state…" readOnly={readOnly} onChange={(id) => { if (id) onChange(setMainPath(doc, id, path.length)); }} />
      )}
      <p className="studio-dg-muted">The layout places every state and route: the main path is its top row, the rest sits below it.</p>
    </Section>
  );
}

export function StateMarksFields({ doc, id, onChange, readOnly }: { doc: Input; id: string; onChange: Change; readOnly: boolean }) {
  const path = doc.mainPath ?? [];
  const step = path.indexOf(id);
  const out = (doc.edges ?? []).filter((edge) => edge.from === id).length;
  return (
    <Section title="In the lifecycle">
      <p className="studio-dg-muted">
        {step === 0 ? 'The initial state: the marker points at it. ' : step > 0 ? `Step ${String(step + 1)} of the main path. ` : 'Off the main path. '}
        {out ? `${String(out)} transition${out === 1 ? '' : 's'} out.` : 'No transition out: a final state, with a double border.'}
      </p>
      {!readOnly && (
        <button type="button" className="studio-button" onClick={() => { onChange(setMainPath(doc, id, step >= 0 ? null : path.length)); }}>
          {step >= 0 ? <X size={14} aria-hidden /> : <Plus size={14} aria-hidden />} {step >= 0 ? 'Take it off the main path' : 'Add it to the main path'}
        </button>
      )}
    </Section>
  );
}
