import { NOTES_DIR } from '../../server/security/asset-types';

// A note's path as the agent panel names it: relative to content/notes.
export const shortPath = (path: string) => (path.startsWith(`${NOTES_DIR}/`) ? path.slice(NOTES_DIR.length + 1) : path);

export const linesLabel = ([first, last]: [number, number]) => (first === last ? `L${String(first)}` : `L${String(first)}-L${String(last)}`);

// The @word the caret is at the end of, if any: an @ at the start or after
// a space, then no space up to the caret.
export function mentionAt(text: string, caret: number) {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return match === null ? null : { start: caret - match[1].length - 1, text: match[1] };
}

// A folder as typed, relative to content/notes (a leading content/notes
// is dropped), its segments without empty ones; null when one is . or ..
export function cleanFolder(folder: string) {
  const segments = folder.trim().split('/').filter((segment) => segment !== '');
  const inside = segments.slice(0, 2).join('/') === NOTES_DIR ? segments.slice(2) : segments;
  return inside.some((segment) => segment === '.' || segment === '..') ? null : inside.join('/');
}
