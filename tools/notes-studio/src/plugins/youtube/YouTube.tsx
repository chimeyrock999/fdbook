import type { ComponentRenderProps } from '@fumadocs-editor/ui';
import { CirclePlay } from 'lucide-react';

// <YouTube> as the same card as `::youtube`: the editor does not embed other
// sites, so the frame is a placeholder. The title region renders in
// `children`, under the frame.
export function YouTube({ props, children }: ComponentRenderProps) {
  return (
    <figure className="studio-card studio-youtube">
      <span data-fde-controls="" contentEditable={false} aria-hidden className="studio-embed-controls" />
      <div className="studio-card-bar" contentEditable={false}>
        <CirclePlay size={14} aria-hidden />
        <span className="studio-card-src">{props.url || props.videoId || 'no url'}</span>
      </div>
      <div className="studio-youtube-frame" contentEditable={false}>
        <CirclePlay size={44} aria-hidden />
      </div>
      {children}
    </figure>
  );
}
