import type { ComponentRenderProps } from '@fumadocs-editor/ui';
import { Workflow } from 'lucide-react';

// A card for <Diagram>, not the drawing: the Studio has no read access to
// diagrams/ yet. It names the file the site draws; the caption region
// renders in `children`.
export function Diagram({ props, children }: ComponentRenderProps) {
  return (
    <figure className="studio-card studio-embed">
      <span data-fde-controls="" contentEditable={false} aria-hidden className="studio-embed-controls" />
      <div className="studio-card-bar" contentEditable={false}>
        <Workflow size={14} aria-hidden />
        <span className="studio-card-src">{props.src ? `diagrams/${props.src}.diagram.json` : 'no src'}</span>
      </div>
      {props.title && (
        <span className="studio-embed-title" contentEditable={false}>
          {props.title}
        </span>
      )}
      {children}
    </figure>
  );
}
