import type { ComponentRenderProps } from '@fumadocs-editor/ui';

// SectionTitle from components/graph-objects.tsx: a heading sized by `as`.
export function SectionTitle({ props, children }: ComponentRenderProps) {
  const { as = 'h3', displayName } = props;
  return (
    <div className="studio-section-title" data-level={as} title={displayName}>
      {children}
    </div>
  );
}
