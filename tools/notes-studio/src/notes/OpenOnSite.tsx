import { ExternalLink } from 'lucide-react';
import { noteRoute, siteUrlFrom } from './notes';

// STUDIO_SITE_URL comes in through vite.config.ts.
const SITE_URL = siteUrlFrom(import.meta.env.STUDIO_SITE_URL as string | undefined);

// Opens the note's page on the site in a new tab. The Studio does not check
// that the site is running.
export function OpenOnSite({ path, siteUrl = SITE_URL }: { path: string; siteUrl?: string }) {
  const href = `${siteUrl.replace(/\/+$/, '')}${noteRoute(path)}`;
  return (
    <a href={href} target="_blank" rel="noreferrer" title={href} aria-label="Open on site" className="studio-button gap-1.5 max-md:px-[7px]">
      <ExternalLink aria-hidden className="size-3.5 flex-none" />
      <span className="max-md:hidden">Open on site</span>
    </a>
  );
}
