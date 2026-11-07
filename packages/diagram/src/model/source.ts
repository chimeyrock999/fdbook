// Where a diagram lives: `<Diagram src>` names `diagrams/<src>.diagram.json`,
// with `src` the path under diagrams/ without the suffix. The site
// (node/read-diagram.ts), the Studio's card and its diagram tools all
// resolve `src` here.

export const DIAGRAMS_DIR = 'diagrams';
export const DIAGRAM_SUFFIX = '.diagram.json';

// The repository-relative posix path `src` names, or null when it is empty
// or would leave diagrams/. A leading `/` and the suffix are allowed. `dir`
// is where the diagrams are, for a project that keeps them elsewhere.
export function diagramPathOf(src: string, dir = DIAGRAMS_DIR): string | null {
  const segments: string[] = [];
  for (const segment of src.trim().replace(/^\/+/, '').replace(/\.diagram\.json$/, '').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.length ? `${dir}/${segments.join('/')}${DIAGRAM_SUFFIX}` : null;
}
