import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// An asset that diagram sources generate, as the retired Archify pipeline
// laid them out: a spec naming it in `meta.output`, a regen script naming it
// in `OUT=`, and a note that embeds it. The repo has none left, so the tests
// of server/assets/sources.ts plant one in their worktree.
export function generatedAsset(name: string) {
  const asset = `public/notes/legacy/${name}.html`;
  return {
    asset,
    spec: `diagrams/legacy/${name}.architecture.json`,
    script: `diagrams/legacy/${name}.regen.sh`,
    note: `content/notes/legacy-${name}.mdx`,
    // What the spec's line 3 and the script's line 2 say.
    specLine: `"output": "${asset}",`,
    scriptLine: `OUT="${asset}"`,
  };
}

// `embed: false` leaves the note out, for an asset no note uses.
export async function plantGeneratedAsset(root: string, name: string, { embed = true } = {}) {
  const generated = generatedAsset(name);
  await mkdir(join(root, 'public/notes/legacy'), { recursive: true });
  await mkdir(join(root, 'diagrams/legacy'), { recursive: true });
  await writeFile(join(root, generated.asset), `<!doctype html><html><body>${name}</body></html>\n`);
  await writeFile(join(root, generated.spec), `{\n  "meta": {\n    ${generated.specLine}\n    "title": "${name}"\n  }\n}\n`);
  await writeFile(join(root, generated.script), `#!/bin/sh\n${generated.scriptLine}\necho "$OUT"\n`);
  if (embed) await writeFile(join(root, generated.note), `---\ntitle: ${name}\n---\n\n<HtmlEmbed src="/notes/legacy/${name}.html?embed=1" title="${name}" />\n`);
  return generated;
}
