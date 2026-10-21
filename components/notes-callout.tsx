import { Bird, Bug, Droplet, Flower2, Leaf, Rat, Snail, Sprout } from 'lucide-react';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { CalloutType } from '@/lib/notes-syntax';

type NotesCalloutType = CalloutType;
type SemanticCalloutType =
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

function getSemanticCalloutType(type: NotesCalloutType | undefined): SemanticCalloutType {
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

function getCalloutColor(type: SemanticCalloutType) {
  return `var(--color-callout-${type})`;
}

function getCalloutBackground(type: SemanticCalloutType) {
  return `var(--color-callout-${type}-bg)`;
}

function getCalloutTitleColor(type: SemanticCalloutType) {
  return `var(--color-callout-${type}-title)`;
}

// Garden-themed lucide glyphs: a little bird brings info, a droplet for notes,
// a sprout for ideas, a leaf for examples, a bloom for success, and the garden
// pests (snail → bug → rat) escalating from caution to danger.
const CALLOUT_ICONS: Record<SemanticCalloutType, typeof Leaf> = {
  caution: Snail,
  danger: Rat,
  example: Leaf,
  idea: Sprout,
  info: Bird,
  note: Droplet,
  success: Flower2,
  warning: Bug,
};

function getCalloutIcon(type: SemanticCalloutType): ReactNode {
  const Icon = CALLOUT_ICONS[type] ?? Bird;
  return <Icon width={18} height={18} aria-hidden="true" />;
}

export function NotesCallout({
  className,
  displayName: _displayName,
  graphKind: _graphKind,
  graphType: _graphType,
  icon,
  title,
  type = 'info',
  children,
  style,
  ...props
}: NotesCalloutProps) {
  const semanticType = getSemanticCalloutType(type);
  const calloutColor = getCalloutColor(semanticType);
  const calloutBackground = getCalloutBackground(semanticType);
  const calloutTitleColor = getCalloutTitleColor(semanticType);
  const resolvedTitle = title ?? LABELS[semanticType];

  const rootStyle = {
    '--notes-callout-color': calloutColor,
    '--notes-callout-background': calloutBackground,
    '--notes-callout-title-color': calloutTitleColor,
    ...style,
  } as CSSProperties;

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
