import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * The file `<Diagram src>` names: `<root>/diagrams/<src>.diagram.json`, where
 * `src` is the path under `diagrams/` without the extension, as in
 * `data-platform/processing/apache-spark/spark-logic-to-execution`. Null when
 * it is empty or would leave `diagrams/`. The site and the Studio's lint both
 * resolve `src` here.
 */
export function diagramFilePath(root: string, src: string): string | null {
  const cleaned = src.trim().replace(/^\/+/, '').replace(/\.diagram\.json$/, '');
  if (!cleaned) return null;

  const diagramsRoot = path.join(root, 'diagrams');
  const resolved = path.resolve(diagramsRoot, `${cleaned}.diagram.json`);
  return resolved.startsWith(`${diagramsRoot}${path.sep}`) ? resolved : null;
}

/**
 * Reads the diagram for `<Diagram>` at build time. Returns `null` instead of
 * throwing, like readPublicAsset, so a bad reference shows a placeholder in
 * the page instead of failing the export.
 */
export async function readDiagramFile(src: string): Promise<unknown | null> {
  const file = diagramFilePath(process.cwd(), src);
  if (!file) return null;

  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}
