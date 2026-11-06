import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { composing } from '../keyboard';

// The fields of the diagram panel (DiagramPanel.tsx, SequencePanel.tsx).

// A text field that changes the diagram once it is left or Enter is
// pressed, so one edit is one undo step. A change from elsewhere (undo, the
// JSON view, an agent) shows as soon as the field is not being edited.
export function TextField({ label, value, onCommit, multiline = false, readOnly, hint }: {
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
    // The hint is not part of the name.
    'aria-label': label,
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
        <input
          {...props}
          onKeyDown={(event) => {
            // The Enter or Escape that ends an IME composition (Telex, VNI) is the IME's.
            if (composing(event)) return;
            if (event.key === 'Enter') commit();
            else if (event.key === 'Escape') setDraft(null);
          }}
        />
      )}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Choice<T extends string>({ label, value, options, onChange, readOnly, none }: {
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
      <span className="studio-dg-select">
        <select className="studio-input" value={value ?? ''} disabled={readOnly} onChange={(event) => { onChange(event.target.value === '' ? undefined : (event.target.value as T)); }}>
          {none !== undefined && <option value="">{none}</option>}
          {items.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <ChevronDown size={14} aria-hidden />
      </span>
    </label>
  );
}

export function Check({ label, checked, onChange, readOnly }: { label: string; checked: boolean; onChange: (checked: boolean) => void; readOnly: boolean }) {
  return (
    <label className="studio-dg-check">
      <input type="checkbox" checked={checked} disabled={readOnly} onChange={(event) => { onChange(event.target.checked); }} />
      {label}
    </label>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="studio-dg-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
