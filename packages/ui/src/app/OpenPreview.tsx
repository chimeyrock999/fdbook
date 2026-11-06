import type { Preview } from '#api/preview.ts';
import { BUILD_LABELS } from '#changes/preview-labels.ts';

// Opens the change request's preview on Cloudflare Pages at `route`, the
// page shown, in a new tab, with a dot for its build. Nothing until the
// branch is pushed.
export function OpenPreview({ preview, route }: { preview: Preview | null; route: string }) {
  if (preview?.pushed == null || preview.url === null) return null;
  const href = `${preview.url}${route}`;
  const state = preview.build?.state ?? 'unknown';
  return (
    <a href={href} target="_blank" rel="noreferrer" title={href} aria-label={`Open preview (${BUILD_LABELS[state]})`} data-build={state} className="studio-button gap-1.5 max-md:px-[7px]">
      <span aria-hidden className="studio-preview-dot" />
      <span className="max-md:hidden">Open preview</span>
    </a>
  );
}
