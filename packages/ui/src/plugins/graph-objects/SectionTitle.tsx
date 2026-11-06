import type { ComponentRenderProps } from '@fumadocs-editor/ui';

const LEVELS = new Set(['h2', 'h3', 'h4', 'h5', 'h6']);

// SectionTitle from components/graph-objects.tsx: the heading `as` names
// (h3 by default), so the site's prose sizes it.
export function SectionTitle({ props, children }: ComponentRenderProps) {
  const { as = 'h3', displayName } = props;
  const Heading = (LEVELS.has(as) ? as : 'h3') as 'h3';
  return (
    <Heading className="studio-section-title" title={displayName}>
      {children}
    </Heading>
  );
}
