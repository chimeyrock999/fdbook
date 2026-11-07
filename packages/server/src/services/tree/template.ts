// A new page gets the frontmatter fumadocs reads: a title and an empty
// description. The title is a double-quoted YAML string, with `\` and `"`
// escaped.

export function pageTemplate(title: string): string {
  const name = title.trim() || 'Untitled';
  const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `---\ntitle: "${escaped}"\ndescription: ""\n---\n\n`;
}
