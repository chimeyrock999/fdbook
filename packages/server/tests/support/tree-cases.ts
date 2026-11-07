import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// The page tree cases FdBook's docs do not have, written into a copy of them
// (makeWorktree) under content/docs:
// - patterns/: the root meta.yaml lists it, but it has no meta.yaml of its
//   own; its index page has an icon, and it holds one folder, caching/. Its
//   index page links to a docs page by its /docs URL, with an anchor.
// - archive/: no meta.yaml lists it. Its own meta.yaml has an icon and lists
//   its index page (with an icon of its own) and two nested pages,
//   old/setup-v1 (which the index page links to) and old/retired
//   (`visible: false`).
// - guide/drafts.mdx: `visible: false`, and guide/meta.yaml leaves it out.
const CASES: Record<string, string> = {
  'patterns/index.mdx': '---\ntitle: "Patterns"\nicon: Sprout\n---\n\nDrawn as in [the examples](/docs/diagrams/examples#architecture).\n',
  'patterns/caching/index.mdx': '---\ntitle: "Caching"\n---\n\nRead-through and write-behind.\n',
  'archive/meta.yaml': 'title: "Archive"\nicon: Archive\ndefaultOpen: true\npages:\n  - "index"\n  - "old/setup-v1"\n  - "old/retired"\n',
  'archive/index.mdx': '---\ntitle: "Archive"\nicon: Shrub\n---\n\nThe [first setup](./old/setup-v1.mdx), kept for the record.\n',
  'archive/old/setup-v1.mdx': '---\ntitle: "Setup, version 1"\n---\n\nHow the Studio was set up at first.\n',
  'archive/old/retired.mdx': '---\ntitle: "Retired"\nvisible: false\n---\n\nA page the site no longer shows.\n',
  'guide/drafts.mdx': '---\ntitle: "Drafts"\nvisible: false\n---\n\nNot ready yet.\n',
};

export async function writeTreeCases(root: string) {
  const notes = (path: string) => join(root, 'content/docs', path);
  for (const [path, content] of Object.entries(CASES)) {
    await mkdir(dirname(notes(path)), { recursive: true });
    await writeFile(notes(path), content);
  }
  const meta = await readFile(notes('meta.yaml'), 'utf8');
  await writeFile(notes('meta.yaml'), `${meta}  - "patterns"\n`);
}
