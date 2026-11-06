// Where a note's YAML frontmatter block sits. No imports, so the server
// (server/services/tree) finds the same block as the editor.

// `---` on the first line, the YAML, then `---` on its own line.
const BLOCK = /^---(\r?\n)(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

// The YAML (without the `---` lines and the newline before the closing
// one), the newline after the opening `---`, and where the block ends; null
// when the note has none.
export function findBlock(source: string) {
  const match = BLOCK.exec(source);
  if (!match) return null;
  const [whole, newline, yaml = ''] = match as unknown as [string, string, string | undefined];
  return { yaml, newline, end: whole.length };
}
