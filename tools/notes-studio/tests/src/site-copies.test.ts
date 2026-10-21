import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../server/config';

// Site components the Studio cannot import (server code, fumadocs-ui, live
// embeds the editor does not run), so a plugin draws its own copy. Each copy
// is pinned to the site file it was made from: when that file changes, this
// fails until the copy is checked against it and the hash is updated.
const COPIES = [
  {
    site: 'components/accordion.tsx',
    sha256: '2dd08eeca1aceedd1ac8cf207f8b2e95410651e5637bce87c4c982b24e52f4aa',
    studio: ['src/plugins/site-directives/decorate.ts (kind icons)', 'src/plugins/site-directives/site-directives.css'],
  },
  {
    site: 'components/mdx/svg-diagram.tsx',
    sha256: '1519ee5d42bb270c3a315f37a9ca2f95af34b6bbfea0fb52c009744ed62a7e98',
    studio: ['src/plugins/svg-diagram/SvgDiagram.tsx', 'src/plugins/svg-diagram/svg-diagram.css'],
  },
  {
    site: 'components/mdx/youtube.tsx',
    sha256: 'ecd1297764e1cb02b0b2b31fea3b19f5d566a782382ebc33b9aedbc773d81525',
    studio: ['src/plugins/youtube/YouTube.tsx'],
  },
  {
    site: 'components/mdx/html-embed.tsx',
    sha256: 'b592acb9af47aa4ec4d6ccd7183893d6deeebd71407933e9cbe80199ef56c508',
    studio: ['src/plugins/html-embed/HtmlEmbed.tsx'],
  },
  {
    site: 'components/codeblock.tsx',
    sha256: '10fa382036eab5fbb68df737b8d2f2c479a1105682f74a31c91b8ee419087360',
    studio: ['src/notes-prose.css (code block frame)'],
  },
];

describe('site copies', () => {
  it.each(COPIES)('$site has not changed since the Studio copied it', async ({ site, sha256, studio }) => {
    const source = (await readFile(join(repoRoot, site), 'utf8')).replace(/\r\n/g, '\n');
    const hash = createHash('sha256').update(source).digest('hex');
    expect(hash, `${site} changed: check that ${studio.join(', ')} still match it, then set its sha256 here to ${hash}`).toBe(sha256);
  });
});
