// The lucide names a note's `icon` can take, from lib/notes-icons.ts with the
// site's own lucide-react (in the browser, Vite would hand it the Studio's, a
// newer set with other names). Loaded once; a failed load (lucide-react still
// installing) is tried again on the next call.
let names: Promise<readonly string[]> | null = null;

export function siteIconNames(): Promise<readonly string[]> {
  names ??= import('../../../../lib/notes-icons.ts').then((module) => module.NOTE_ICON_NAMES);
  names.catch(() => {
    names = null;
  });
  return names;
}
