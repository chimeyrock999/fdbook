import type { ComponentRenderProps } from '@fumadocs-editor/ui';
import { coerceBoolean, coerceNumber } from '@site/lib/mdx-props';
import { Image } from 'lucide-react';
import { publicAssetUrl } from '../../api/files';

// components/mdx/svg-diagram.tsx as an image from the file API, with the
// site's reading of its props. The site inlines the SVG, so a diagram drawn
// in `currentColor` can look darker here. A bare JSX boolean (`<SvgDiagram
// plate />`) has no string value, so the editor does not pass it here; write
// `plate="true"` to see it. The caption region renders in `children`.
export function SvgDiagram({ props, children }: ComponentRenderProps) {
  const url = publicAssetUrl(props.src);
  const maxWidth = coerceNumber(props.maxWidth);
  const plate = coerceBoolean(props.plate) ?? false;
  const invert = !plate && (coerceBoolean(props.invertOnDark) ?? false);
  let fallback = 'Not a file under public/notes/';
  if (props.svg) fallback = 'Inline SVG: shown on the site';
  return (
    <figure className="studio-card studio-svg-diagram">
      <span data-fde-controls="" contentEditable={false} aria-hidden className="studio-embed-controls" />
      <div className="studio-card-bar" contentEditable={false}>
        <Image size={14} aria-hidden />
        <span className="studio-card-src">{props.src || 'inline svg'}</span>
      </div>
      <div className="studio-svg-diagram-view" contentEditable={false} data-plate={plate || undefined} data-invert={invert || undefined}>
        {url ? <img src={url} alt={props.label} style={{ maxWidth }} /> : <span>{fallback}</span>}
      </div>
      {children}
    </figure>
  );
}
