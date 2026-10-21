const ATTRIBUTE = /([^\s"'=<>`{}]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`{}]+)))?/g;

// The string attributes of a JSX tag (`id="a" displayName='B'`) or of a
// directive's `{…}` (also unquoted values). Bare names are empty strings;
// `#id` and `.class` shorthands are not read.
export function attributes(source: string): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    const [, name, double, single, bare] = match as unknown as [string, string, ...(string | undefined)[]];
    out[name] = double ?? single ?? bare ?? '';
  }
  return out;
}
