import type { ComponentRenderProps } from '@fumadocs-editor/ui';
import { AppWindow } from 'lucide-react';

// A card for <HtmlEmbed>, not the live iframe: the file API serves HTML
// assets sandboxed with no scripts, so most embeds would show nothing. The
// title and caption regions render in `children`.
export function HtmlEmbed({ props, children }: ComponentRenderProps) {
  return (
    <figure className="studio-card studio-embed">
      <span data-fde-controls="" contentEditable={false} aria-hidden className="studio-embed-controls" />
      <div className="studio-card-bar" contentEditable={false}>
        <AppWindow size={14} aria-hidden />
        <span className="studio-card-src">{props.src || 'no src'}</span>
      </div>
      {children}
    </figure>
  );
}
