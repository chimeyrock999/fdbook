import { Bean, Broccoli, Bug, Carrot, type LucideIcon, Nut, PawPrint, Squirrel, Star } from 'lucide-react';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { cn } from '#cn.ts';
import type { CalloutType } from '#notes-syntax.ts';

type NotesCalloutType = CalloutType;
export type SemanticCalloutType =
  | 'caution'
  | 'danger'
  | 'example'
  | 'idea'
  | 'info'
  | 'note'
  | 'success'
  | 'warning';

type NotesCalloutProps = Omit<ComponentProps<'div'>, 'title'> & {
  type?: NotesCalloutType;
  title?: ReactNode;
  icon?: ReactNode;
  /** ignored — kept for MDX/graph compatibility */
  displayName?: string;
  graphKind?: 'section' | 'keyword';
  graphType?: 'section' | 'keyword';
};

// Any string: a type the site does not know is drawn as `info`.
export function getSemanticCalloutType(type: string | undefined): SemanticCalloutType {
  switch (type) {
    case 'tip':
      return 'idea';
    case 'caution':
    case 'important':
      return 'caution';
    case 'warn':
    case 'warning':
      return 'warning';
    case 'danger':
    case 'error':
      return 'danger';
    case 'example':
    case 'idea':
    case 'info':
    case 'note':
    case 'success':
      return type;
    default:
      return 'info';
  }
}

const LABELS: Record<SemanticCalloutType, string> = {
  caution: 'Caution',
  danger: 'Danger',
  example: 'Example',
  idea: 'Tip',
  info: 'Info',
  note: 'Note',
  success: 'Success',
  warning: 'Warning',
};

// The variables the callout's CSS (styles/notes-prose.css) draws with.
export function getCalloutVariables(type: SemanticCalloutType) {
  return {
    '--notes-callout-color': `var(--color-callout-${type})`,
    '--notes-callout-title-color': `var(--color-callout-${type}-title)`,
  };
}

// Garden-themed lucide glyphs: what grows and is gathered in the garden for
// the neutral types (a carrot for info, a nut for notes, a bean for ideas,
// broccoli for examples, a star for success), and the creatures that
// visit it for the warnings (paw prints → squirrel → bug).
export const CALLOUT_ICONS: Record<SemanticCalloutType, LucideIcon> = {
  caution: Squirrel,
  danger: Bug,
  example: Broccoli,
  idea: Bean,
  info: Carrot,
  note: Nut,
  success: Star,
  warning: PawPrint,
};

function getCalloutIcon(type: SemanticCalloutType): ReactNode {
  const Icon = CALLOUT_ICONS[type];
  return <Icon width={18} height={18} aria-hidden="true" />;
}

export function NotesCallout({
  className,
  icon,
  title,
  type = 'info',
  children,
  style,
  ...props
}: NotesCalloutProps) {
  // The graph fields are for MDX and the graph, not the div.
  delete props.displayName;
  delete props.graphKind;
  delete props.graphType;
  const semanticType = getSemanticCalloutType(type);
  const resolvedTitle = title ?? LABELS[semanticType];

  const rootStyle = { ...getCalloutVariables(semanticType), ...style } as CSSProperties;

  return (
    <div {...props} className={cn('notes-callout', className)} style={rootStyle}>
      <div className="notes-callout-head">
        <span className="notes-callout-icon">{icon ?? getCalloutIcon(semanticType)}</span>
        <span className="notes-callout-title">{resolvedTitle}</span>
      </div>
      <div className="notes-callout-body">{children}</div>
    </div>
  );
}
