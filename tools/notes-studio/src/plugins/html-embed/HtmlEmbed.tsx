import type { ComponentRenderProps } from '@fumadocs-editor/ui';

// A card for <HtmlEmbed>, not the live iframe: the Studio serves no public/
// pages. The title and caption regions render in `children`.
export function HtmlEmbed({ props, children }: ComponentRenderProps) {
  return (
    <figure className="studio-embed">
      <span data-fde-controls="" contentEditable={false} aria-hidden className="studio-embed-controls" />
      <div className="studio-embed-bar" contentEditable={false}>
        <span className="studio-embed-tag">HtmlEmbed</span>
        <span className="studio-embed-src">{props.src || 'no src'}</span>
      </div>
      {children}
    </figure>
  );
}
