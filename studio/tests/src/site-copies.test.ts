import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installRoot } from '../../server/config';

// Site code the Studio cannot import (server reads, fumadocs-ui, live embeds
// the editor does not run), so a plugin draws its own copy. The site marks
// each part a copy mirrors with `// studio-copy start: …` and
// `// studio-copy end`, and the hash of those parts is pinned here: when
// one changes, this fails until the copy is checked against it and the hash
// is updated. Edits elsewhere in the file leave it alone.
const COPIES = [
  { site: 'components/accordion.tsx', sha256: 'f26116519f014db836a2b4fca0667f0f3b72c700b43e97302de9beea95dbcd53' },
  { site: 'components/codeblock.tsx', sha256: '55b86f2952bf791906e4fcae511b7b3d4260af763ac8acb14e9e463d6385d12b' },
  { site: 'components/mdx/svg-diagram.tsx', sha256: '40a429227384ecd79acdcfb6e830c81d6c92eb20bd2cdca8932cd6ea7a8ca015' },
  { site: 'components/mdx/youtube.tsx', sha256: '0d899e93e4320eac099755574130ae30c79249a04381865bb11f9a83ed4c7bca' },
  { site: 'components/mdx/html-embed.tsx', sha256: '58eb89c3dac0c2cb5b628ad8c47f47052ee41eb97a458015720c901c0c0cb91a' },
  { site: 'components/mdx/diagram.tsx', sha256: '7ad83697a4e5d0eb78bd430a8d70af46c252c16dac28e77528f88af16c8b01a9' },
];

const START = /^\/\/ studio-copy start: the Notes Studio mirrors this in (studio\/\S+)/;
const END = '// studio-copy end';

// The marked parts of a site file, and the Studio paths their markers name.
function regions(source: string) {
  const parts: string[] = [];
  const studio: string[] = [];
  let current: string[] | null = null;
  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    const start = START.exec(line);
    if (start) {
      expect(current, 'a studio-copy region opens inside another').toBeNull();
      current = [];
      studio.push(start[1].replace(/[;,]$/, ''));
    } else if (line === END) {
      expect(current, 'a studio-copy end without a start').not.toBeNull();
      parts.push((current ?? []).join('\n'));
      current = null;
    } else if (current && !line.startsWith('// studio/tests/src/site-copies.test.ts')) current.push(line);
  }
  expect(current, 'a studio-copy region is not closed').toBeNull();
  return { parts, studio };
}

describe('site copies', () => {
  it.each(COPIES)('the parts of $site the Studio copies have not changed', async ({ site, sha256 }) => {
    const { parts, studio } = regions(await readFile(join(installRoot, site), 'utf8'));
    expect(parts.length, `${site} marks no studio-copy region`).toBeGreaterThan(0);
    for (const path of studio) expect(existsSync(join(installRoot, path)), path).toBe(true);
    const hash = createHash('sha256').update(parts.join('\n\n')).digest('hex');
    expect(hash, `${site} changed in a part the Studio copies: check ${[...new Set(studio)].join(', ')} against it, then set its sha256 here to ${hash}`).toBe(sha256);
  });

  it('reads only the marked parts', () => {
    const { parts } = regions(['a', '// studio-copy start: the Notes Studio mirrors this in studio/src (x);', 'kept', '// studio-copy end', 'b'].join('\n'));
    expect(parts).toEqual(['kept']);
  });
});
