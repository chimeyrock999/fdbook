const ATTRIBUTE = /([^\s"'=<>`{}]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`{}]+)))?/g;

// Each attribute of a list, with where it is in it: quoted values are read
// whole, so a name inside another attribute's value is not an attribute.
export function attributeSpans(source: string): { name: string; from: number; to: number }[] {
  return [...source.matchAll(ATTRIBUTE)].map((match) => ({ name: match[1], from: match.index, to: match.index + match[0].length }));
}

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
