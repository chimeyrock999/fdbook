import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { diagramPathOf } from '#model/source.ts';

/**
 * The file `<Diagram src>` names: `<root>/diagrams/<src>.diagram.json`, where
 * `src` is the path under `diagrams/` without the extension, as in
 * `data-platform/processing/apache-spark/spark-logic-to-execution`. Null when
 * it is empty or would leave `diagrams/`. The site and the Studio's lint both
 * resolve `src` here; `dir` is the diagrams folder under `root`.
 */
export function diagramFilePath(root: string, src: string, dir?: string): string | null {
  const relative = diagramPathOf(src, dir);
  return relative ? path.join(root, relative) : null;
}

/**
 * Reads the diagram for `<Diagram>` at build time. Returns `null` instead of
 * throwing, like readPublicAsset, so a bad reference shows a placeholder in
 * the page instead of failing the export.
 */
export async function readDiagramFile(src: string): Promise<unknown> {
  const file = diagramFilePath(process.cwd(), src);
  if (!file) return null;

  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}
