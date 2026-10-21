import type { ComponentRenderProps } from '@fumadocs-editor/ui';
import { ChevronDown } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { floatMenu } from '../picker-menu';
import { ICONS, semanticType } from './types';

// components/notes-callout.tsx in the editor: an icon and title bar over a
// tinted body. The title and body regions render in `children` (see
// callout.css for how they land in the bar and below it); the icon picks the
// type.

// Whether the editor around `element` takes edits: a locked note keeps its
// callout types. The render props carry no editable flag.
function editable(element: Element) {
  return element.closest('.ProseMirror')?.getAttribute('contenteditable') === 'true';
}

export function SiteCallout({ props, children, setProp, types }: ComponentRenderProps & { types: string[] }) {
  const { type = 'info' } = props;
  const semantic = semanticType(type);
  const Icon = ICONS[semantic];
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLSpanElement>(null);

  // The menu is drawn on document.body over the note (picker-menu.ts); a
  // press outside or Escape closes it, Escape back on the icon.
  useLayoutEffect(() => {
    if (!open || !menu.current || !picker.current || !button.current) return;
    return floatMenu({ menu: menu.current, picker: picker.current, button: button.current }, () => { setOpen(false); });
  }, [open]);
  const style = {
    '--notes-callout-color': `var(--color-callout-${semantic})`,
    '--notes-callout-background': `var(--color-callout-${semantic}-bg)`,
    '--notes-callout-title-color': `var(--color-callout-${semantic}-title)`,
  } as CSSProperties;

  return (
    <div className="studio-callout" style={style} data-type={type}>
      <span ref={picker} className="studio-picker studio-callout-picker" contentEditable={false}>
        <button
          ref={button}
          type="button"
          className="studio-picker-button studio-callout-icon"
          aria-label={`Callout type: ${type}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(event) => { setOpen(!open && editable(event.currentTarget)); }}
        >
          <Icon size={18} aria-hidden />
          <ChevronDown size={10} className="studio-picker-chevron" aria-hidden />
        </button>
        {open && createPortal(
          <span ref={menu} role="menu" className="studio-picker-menu">
            {types.map((option) => {
              const OptionIcon = ICONS[semanticType(option)];
              return (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option === type}
                  style={{ color: `var(--color-callout-${semanticType(option)}-title)` }}
                  onClick={() => {
                    setProp('type', option);
                    setOpen(false);
                  }}
                >
                  <OptionIcon size={14} aria-hidden />
                  <span>{option}</span>
                </button>
              );
            })}
          </span>,
          document.body,
        )}
      </span>
      {children}
    </div>
  );
}
