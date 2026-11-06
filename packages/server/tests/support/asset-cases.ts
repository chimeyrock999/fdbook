import { appendFile, cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { docsRoot } from '@fdbook/testing/notes.ts';

// FdBook's docs show no image, so the asset tests give a copy of them
// (makeWorktree) their public/docs and diagrams, and three files that pages
// use, each from one page:
// - PANES, the docs' own studio-panes.svg, as a Markdown image in using.mdx;
// - SIGN_IN, a .webp with underscores in its name, as an image in setup.mdx;
// - REQUEST_PATH, an .svg, as an <SvgDiagram src> in architecture.mdx.
export const PANES = {
  asset: 'public/docs/guide/using/studio-panes.svg',
  note: 'content/docs/guide/using.mdx',
  line: "![The Studio's panes: tree, editor and sidebar](/docs/guide/using/studio-panes.svg)",
};
export const SIGN_IN = {
  asset: 'public/docs/guide/setup/sign_in_flow.webp',
  note: 'content/docs/guide/setup.mdx',
  line: '![Signing in with GitHub](/docs/guide/setup/sign_in_flow.webp)',
};
export const REQUEST_PATH = {
  asset: 'public/docs/reference/architecture/request-path.svg',
  note: 'content/docs/reference/architecture.mdx',
  line: '<SvgDiagram src="/docs/reference/architecture/request-path.svg" label="A request through the checks" />',
};

export async function writeAssetCases(root: string) {
  const file = (path: string) => join(root, path);
  await cp(join(docsRoot, 'public/docs'), file('public/docs'), { recursive: true });
  await cp(join(docsRoot, 'diagrams'), file('diagrams'), { recursive: true });
  for (const { asset, note, line } of [PANES, SIGN_IN, REQUEST_PATH]) {
    await mkdir(dirname(file(asset)), { recursive: true });
    if (asset !== PANES.asset) await writeFile(file(asset), asset.endsWith('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg"/>\n' : 'webp bytes');
    await appendFile(file(note), `\n${line}\n`);
  }
}
