import { Callout as BaseCallout } from 'fumadocs-ui/components/callout';
import {
  BadgeCheck,
  CircleAlert,
  Info,
  OctagonX,
  Notebook,
} from 'lucide-react';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type NotesCalloutProps = ComponentProps<typeof BaseCallout>;

const iconClassName = 'mt-0.5 size-5 shrink-0 text-[var(--color-graph-primary)]';

function getCalloutType(type: NotesCalloutProps['type']) {
  if (type === 'warn') return 'warning';
  return type ?? 'info';
}

function getCalloutColor(type: NotesCalloutProps['type']) {
  switch (getCalloutType(type)) {
    case 'idea':
      return 'var(--color-callout-idea)';
    case 'warning':
      return 'var(--color-callout-warning)';
    case 'error':
      return 'var(--color-callout-error)';
    case 'success':
      return 'var(--color-callout-success)';
    case 'info':
    default:
      return 'var(--color-callout-info)';
  }
}

function getCalloutBackground(type: NotesCalloutProps['type']) {
  switch (getCalloutType(type)) {
    case 'idea':
      return 'var(--color-callout-idea-bg)';
    case 'warning':
      return 'var(--color-callout-warning-bg)';
    case 'error':
      return 'var(--color-callout-error-bg)';
    case 'success':
      return 'var(--color-callout-success-bg)';
    case 'info':
    default:
      return 'var(--color-callout-info-bg)';
  }
}

function getCalloutTitleColor(type: NotesCalloutProps['type']) {
  switch (getCalloutType(type)) {
    case 'idea':
      return 'var(--color-callout-idea-title)';
    case 'warning':
      return 'var(--color-callout-warning-title)';
    case 'error':
      return 'var(--color-callout-error-title)';
    case 'success':
      return 'var(--color-callout-success-title)';
    case 'info':
    default:
      return 'var(--color-callout-info-title)';
  }
}

function getCalloutIcon(type: NotesCalloutProps['type']): ReactNode {
  switch (getCalloutType(type)) {
    case 'idea':
      return <Notebook className={iconClassName} />;
    case 'warning':
      return <CircleAlert className={iconClassName} />;
    case 'error':
      return <OctagonX className={iconClassName} />;
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
  const calloutColor = getCalloutColor(type);
  const calloutBackground = getCalloutBackground(type);
  const calloutTitleColor = getCalloutTitleColor(type);
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
      type={type}
      icon={icon ?? getCalloutIcon(type)}
      className={cn(
        'border-[color:var(--notes-callout-color)] bg-[var(--notes-callout-background)] ps-3 shadow-sm [&>svg]:text-[color:var(--notes-callout-color)] [&>svg]:after:hidden [&>[role=none]]:hidden [&>svg+div]:border-s-2 [&>svg+div]:border-[color:color-mix(in_oklab,var(--notes-callout-color)_calc(var(--color-callout-separator-alpha)*100%),transparent)] [&>svg+div]:ps-3 [&>svg+div]:text-[0.8125rem] [&>svg+div]:leading-6 [&>svg+div>div]:text-[color:color-mix(in_oklab,var(--color-fd-foreground)_78%,var(--notes-callout-color))] [&>svg+div>p:first-child]:text-[color:var(--notes-callout-title-color)]',
        className,
      )}
      style={style}
    />
  );
}
