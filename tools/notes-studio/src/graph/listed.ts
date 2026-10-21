const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// The entries of a note's `graph` frontmatter that list an id, by their key
// path (`graph.keywords.1`, `graph.sections.0.keywords.2`). The frontmatter
// may be a draft that does not pass the schema yet, so nothing is assumed
// about its shape.
export function listedIn(graph: unknown, id: string): string[] {
  const out: string[] = [];
  if (id === '' || !isRecord(graph)) return out;
  const scan = (list: unknown, path: string) => {
    if (!Array.isArray(list)) return;
    list.forEach((entry: unknown, index) => {
      if (isRecord(entry) && entry.id === id) out.push(`${path}.${String(index)}`);
    });
  };
  scan(graph.keywords, 'graph.keywords');
  scan(graph.sections, 'graph.sections');
  if (Array.isArray(graph.sections)) {
    graph.sections.forEach((section: unknown, index) => {
      if (isRecord(section)) scan(section.keywords, `graph.sections.${String(index)}.keywords`);
    });
  }
  return out;
}
