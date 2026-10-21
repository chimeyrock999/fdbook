// A new page gets the frontmatter the notes use, as the retired Obsidian
// plugin wrote it: title, an empty description, and graph metadata named
// after the slug. The title is a double-quoted YAML string, with `\` and `"`
// escaped. Slugs drop accents and turn `đ` into `d`, like the site's heading
// slugs (source.config.ts).

export function normalizeSlug(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function pageTemplate(slug: string, title: string): string {
  const name = title.trim() || 'Untitled';
  const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const graphId = normalizeSlug(slug) || 'untitled';
  return `---\ntitle: "${escaped}"\ndescription: ""\ngraph:\n  id: "${graphId}"\n  displayName: "${escaped}"\n  keywords: []\n  sections: []\n---\n\n`;
}
