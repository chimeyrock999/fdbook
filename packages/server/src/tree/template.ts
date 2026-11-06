// A new page gets the frontmatter the notes use, as the retired Obsidian
// plugin wrote it: title, an empty description, and graph metadata named
// after the slug. The title is a double-quoted YAML string, with `\` and `"`
// escaped. Slugs come from the UI's `slugify` (src/slug.ts), so the server
// accepts exactly what the dialogs make.

import { slugify } from '@fdbook/shared/slug.ts';

export function pageTemplate(slug: string, title: string): string {
  const name = title.trim() || 'Untitled';
  const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const graphId = slugify(slug) || 'untitled';
  return `---\ntitle: "${escaped}"\ndescription: ""\ngraph:\n  id: "${graphId}"\n  displayName: "${escaped}"\n  keywords: []\n  sections: []\n---\n\n`;
}
