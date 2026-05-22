import { Callout as BaseCallout } from 'fumadocs-ui/components/callout';
import {
  BadgeCheck,
  CircleAlert,
  Info,
  Lightbulb,
  NotebookText,
  OctagonX,
  TriangleAlert,
} from 'lucide-react';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type BaseCalloutProps = ComponentProps<typeof BaseCallout>;
type NotesCalloutType = NonNullable<BaseCalloutProps['type']> | 'caution' | 'danger' | 'important' | 'note' | 'tip';
type BaseCalloutType = NonNullable<BaseCalloutProps['type']>;
type SemanticCalloutType = 'caution' | 'danger' | 'idea' | 'info' | 'note' | 'success' | 'warning';
type NotesCalloutProps = Omit<BaseCalloutProps, 'type'> & {
  type?: NotesCalloutType;
};

const iconClassName = 'mt-0.5 size-5 shrink-0 text-[var(--color-graph-primary)]';

function getCalloutType(type: NotesCalloutType | undefined): BaseCalloutType {
  switch (type) {
    case 'tip':
      return 'idea';
    case 'caution':
    case 'important':
    case 'warn':
    case 'warning':
      return 'warning';
    case 'danger':
      return 'error';
    case 'error':
    case 'idea':
    case 'info':
    case 'success':
      return type;
    case 'note':
    default:
      return 'info';
  }
}

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
    case 'idea':
    case 'info':
    case 'note':
    case 'success':
      return type;
    default:
      return 'info';
  }
}

function getCalloutColor(type: SemanticCalloutType) {
  switch (type) {
    case 'caution':
      return 'var(--color-callout-caution)';
    case 'danger':
      return 'var(--color-callout-danger)';
    case 'idea':
      return 'var(--color-callout-idea)';
    case 'note':
      return 'var(--color-callout-note)';
    case 'warning':
      return 'var(--color-callout-warning)';
    case 'success':
      return 'var(--color-callout-success)';
    case 'info':
    default:
      return 'var(--color-callout-info)';
  }
}

function getCalloutBackground(type: SemanticCalloutType) {
  switch (type) {
    case 'caution':
      return 'var(--color-callout-caution-bg)';
    case 'danger':
      return 'var(--color-callout-danger-bg)';
    case 'idea':
      return 'var(--color-callout-idea-bg)';
    case 'note':
      return 'var(--color-callout-note-bg)';
    case 'warning':
      return 'var(--color-callout-warning-bg)';
    case 'success':
      return 'var(--color-callout-success-bg)';
    case 'info':
    default:
      return 'var(--color-callout-info-bg)';
  }
}

function getCalloutTitleColor(type: SemanticCalloutType) {
  switch (type) {
    case 'caution':
      return 'var(--color-callout-caution-title)';
    case 'danger':
      return 'var(--color-callout-danger-title)';
    case 'idea':
      return 'var(--color-callout-idea-title)';
    case 'note':
      return 'var(--color-callout-note-title)';
    case 'warning':
      return 'var(--color-callout-warning-title)';
    case 'success':
      return 'var(--color-callout-success-title)';
    case 'info':
    default:
      return 'var(--color-callout-info-title)';
  }
}

function getCalloutIcon(type: SemanticCalloutType): ReactNode {
  switch (type) {
    case 'caution':
      return <CircleAlert className={iconClassName} />;
    case 'danger':
      return <OctagonX className={iconClassName} />;
    case 'idea':
      return <Lightbulb className={iconClassName} />;
    case 'note':
      return <NotebookText className={iconClassName} />;
    case 'warning':
      return <TriangleAlert className={iconClassName} />;
    case 'success':
      return <BadgeCheck className={iconClassName} />;
    case 'info':
    default:
      return <Info className={iconClassName} />;
  }
}

export function NotesCallout({
  className,
  displayName: _displayName,
  graphKind: _graphKind,
  graphType: _graphType,
  icon,
  type = 'info',
  ...props
}: NotesCalloutProps & {
  displayName?: string;
  graphKind?: 'section' | 'keyword';
  graphType?: 'section' | 'keyword';
}) {
  const calloutType = getCalloutType(type);
  const semanticType = getSemanticCalloutType(type);
  const calloutColor = getCalloutColor(semanticType);
  const calloutBackground = getCalloutBackground(semanticType);
  const calloutTitleColor = getCalloutTitleColor(semanticType);
  const style = {
    '--callout-color': calloutColor,
    '--notes-callout-background': calloutBackground,
    '--notes-callout-color': calloutColor,
    '--notes-callout-title-color': calloutTitleColor,
    ...props.style,
  } as CSSProperties;

  return (
    <BaseCallout
      {...props}
      type={calloutType}
      icon={icon ?? getCalloutIcon(semanticType)}
      className={cn(
        'border-[color:var(--notes-callout-color)] bg-[var(--notes-callout-background)] ps-3 shadow-sm [&>svg]:text-[color:var(--notes-callout-color)] [&>svg]:after:hidden [&>[role=none]]:hidden [&>svg+div]:border-s-2 [&>svg+div]:border-[color:color-mix(in_oklab,var(--notes-callout-color)_calc(var(--color-callout-separator-alpha)*100%),transparent)] [&>svg+div]:ps-3 [&>svg+div]:text-[0.8125rem] [&>svg+div]:leading-6 [&>svg+div>div]:text-[color:color-mix(in_oklab,var(--color-fd-foreground)_78%,var(--notes-callout-color))] [&>svg+div>p:first-child]:text-[color:var(--notes-callout-title-color)]',
        className,
      )}
      style={style}
    />
  );
}
