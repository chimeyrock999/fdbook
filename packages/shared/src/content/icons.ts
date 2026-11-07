import { icons } from 'lucide-react';

// The names a note's `icon` key can take: the site renders it with fumadocs'
// lucideIconsPlugin, which looks the name up in this lucide-react. Notes
// Studio's icon picker offers these, not the set its own lucide-react has.
export const NOTE_ICON_NAMES: readonly string[] = Object.keys(icons);
