import type { ComponentRenderProps } from '@fumadocs-editor/ui';
import { ChevronDown } from 'lucide-react';
import { CALLOUT_ICONS, getCalloutVariables, getSemanticCalloutType } from '@site/components/notes-callout';
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { floatMenu } from '../picker-menu';

// components/notes-callout.tsx in the editor, with its classes, so the
// site's callout CSS (styles/notes-prose.css) draws it: one tinted block, the
// icon on a badge beside the title and the body under the title. The title
// and body regions render in `children` (see callout.css for how they land
// beside the icon and below the title); the icon picks the type.

// Whether the editor around `element` takes edits: a locked note keeps its
// callout types. The render props carry no editable flag.
function editable(element: Element) {
  return element.closest('.ProseMirror')?.getAttribute('contenteditable') === 'true';
}

export function SiteCallout({ props, children, setProp, types }: ComponentRenderProps & { types: string[] }) {
  const { type = 'info' } = props;
  const semantic = getSemanticCalloutType(type);
  const Icon = CALLOUT_ICONS[semantic];
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLSpanElement>(null);
  // Whether the menu was opened from the keyboard: then the focus goes to
  // the checked type.
  const fromKeyboard = useRef(false);

  // The menu is drawn on document.body over the note (picker-menu.ts); a
  // press outside or Escape closes it, Escape back on the icon.
  useLayoutEffect(() => {
    if (!open || !menu.current || !picker.current || !button.current) return;
    const focus = fromKeyboard.current;
    return floatMenu({ menu: menu.current, picker: picker.current, button: button.current, focus }, () => { setOpen(false); });
  }, [open]);
  const style = getCalloutVariables(semantic) as CSSProperties;

  return (
    <div className="notes-callout studio-callout" style={style} data-type={type}>
      <span ref={picker} className="notes-callout-head studio-picker studio-callout-picker" contentEditable={false}>
        <button
          ref={button}
          type="button"
          className="notes-callout-icon studio-picker-button studio-callout-icon"
          aria-label={`Callout type: ${type}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(event) => {
            // Enter and Space click with no press count.
            fromKeyboard.current = event.detail === 0;
            setOpen(!open && editable(event.currentTarget));
          }}
        >
          <Icon size={18} aria-hidden />
          <ChevronDown size={10} className="studio-picker-chevron" aria-hidden />
        </button>
        {open && createPortal(
          <span ref={menu} role="menu" className="studio-picker-menu">
            {types.map((option) => {
              const OptionIcon = CALLOUT_ICONS[getSemanticCalloutType(option)];
              return (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option === type}
                  style={{ color: `var(--color-callout-${getSemanticCalloutType(option)}-title)` }}
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
