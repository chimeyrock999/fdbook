// New pages are written like obsidian-plugin's page creation
// (obsidian-plugin/src/services/page-creation.ts), so a note looks the same
// whichever tool made it. tests/server/tree/template.test.ts compares the two.

export function normalizeSlug(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function pageTemplate(slug: string, title: string): string {
  const name = title.trim() || 'Untitled';
  const escaped = name.replace(/"/g, '\\"');
  const graphId = normalizeSlug(slug) || 'untitled';
  return `---\ntitle: "${escaped}"\ndescription: ""\ngraph:\n  id: "${graphId}"\n  displayName: "${escaped}"\n  keywords: []\n  sections: []\n---\n\n`;
}
