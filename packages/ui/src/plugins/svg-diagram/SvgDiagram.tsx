import type { ComponentRenderProps } from '@fumadocs-editor/ui';
import { coerceBoolean, coerceNumber } from '@fdbook/mdx/mdx-props.ts';
import { Image } from 'lucide-react';
import { publicAssetUrl } from '#api/files.ts';
import { ASSETS_DIR } from '@fdbook/shared/asset-types.ts';

// components/mdx/svg-diagram.tsx as an image, with the site's reading of its
// props: inline `svg` markup first, else the `src` file from the file API.
// As an image, inline markup runs no script. The site inlines the SVG, so a diagram drawn
// in `currentColor` can look darker here. A bare JSX boolean (`<SvgDiagram
// plate />`) has no string value, so the editor does not pass it here; write
// `plate="true"` to see it. The caption region renders in `children`.
export function SvgDiagram({ props, children }: ComponentRenderProps) {
  const url = props.svg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(props.svg)}`
    : publicAssetUrl(props.src);
  const maxWidth = coerceNumber(props.maxWidth);
  const plate = coerceBoolean(props.plate) ?? false;
  const invert = !plate && (coerceBoolean(props.invertOnDark) ?? false);
  return (
    <figure className="studio-card studio-svg-diagram">
      <span data-fde-controls="" contentEditable={false} aria-hidden className="studio-embed-controls" />
      <div className="studio-card-bar" contentEditable={false}>
        <Image size={14} aria-hidden />
        <span className="studio-card-src">{props.svg ? 'inline svg' : props.src || 'no src'}</span>
      </div>
      <div className="studio-svg-diagram-view" contentEditable={false} data-plate={plate || undefined} data-invert={invert || undefined}>
        {url ? <img src={url} alt={props.label} style={{ maxWidth }} /> : <span>Not a file under {ASSETS_DIR}/</span>}
      </div>
      {children}
    </figure>
  );
}
