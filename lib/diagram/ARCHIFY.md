# The Archify port

The layout, routing, label placement and legend in this folder are ported
from [Archify](https://github.com/tt-a1i/archify) (MIT, `LICENSE.archify`).
Archify keeps releasing, so the port follows it as an upstream: its fixes
come here, and bugs found here go back to it.

Matches Archify **v3.2.0** (released 2026-10-19). The fixtures were first
made at commit 88d1ae44, after v3.1.0; v3.2.0 lays out every spec the same
way, and its architecture renderer and the shared files below are unchanged
from that commit.

## What comes from where

| Here | Archify |
|---|---|
| `geometry.ts` | `renderers/shared/geometry.mjs`, `utils.mjs` |
| `router.ts`, `router-sweep.ts` | `renderers/architecture/routing.mjs` |
| `grid-route.ts` | `renderers/shared/route-quality.mjs` |
| `labels.ts` | `renderers/shared/automatic-labels.mjs`, `spatial-grid.mjs` |
| `legend.ts` | `renderers/shared/legend.mjs` |
| `scene.ts`, `render.ts` | `renderers/architecture/render-architecture.mjs` (showcase profile); icons and arrow markers from `renderers/shared/utils.mjs` |
| `validate.ts` (text and overlap limits) | `renderers/architecture/render-architecture.mjs` validation, `renderers/shared/text-fit.mjs`, `desktop-readability.mjs` |
| `import-archify.ts` (dataflow grid: `leftX`, `colGap`, `stageW`, `nodeW`, `nodeH`, `rowYs`) | `renderers/dataflow/dataflow-compiler.mjs` |

Archify's JSON IR, its HTML pipeline and its other renderers are not ported;
`import-archify.ts` converts its architecture and dataflow specs.

## Checking a release

`tests/fixtures/archify` holds eight Archify specs with Archify's own layout
of each architecture spec (`*.layout.json`, from
`render-architecture.mjs --layout-json`), and `tests/diagram-archify.test.ts`
holds the port to those layouts.

1. Get the release: the installed skill (`~/.claude/skills/archify`, kept
   current by its updater), an unpacked release, or a checkout
   (`git clone --branch v<version> https://github.com/tt-a1i/archify`).
2. `npm run archify:fixtures -- <archify dir> --check` says which layouts the
   release changes; without `--check` it rewrites them. A layout that differs
   only in its `source` line is the same.
3. Rewrite the fixtures and run `npm test`.
   - The parity test passes: update the version above. The fixtures now name
     it, and `tests/diagram-archify-fixtures.test.ts` fails until this file
     and every fixture agree.
   - It fails: read the release's changes to the files in the table and port
     them, keeping Archify's constants and comparisons as they are there,
     until it passes. Then update the version.
4. Read the release's `SKILL.md` and `references/` (`authoring-defaults.md`,
   `architecture-layout-repair.md`, `authoring-contract.md`,
   `delivery-contract.md`) for guidance worth bringing into
   `skills/chimeyrock-diagram`. `delivery-contract.md` is mostly Archify's
   finalize and browser pipeline; only its repair rules (such as the
   two-round limit) apply here.

The dataflow constants have no layout fixture: compare them with
`dataflow-compiler.mjs` by hand.

## Sending fixes back

A bug found in the ported code is fixed here and reported to Archify too:
check whether the original file has it, and draft the report (the Archify
file, a repro, the fix) in `upstream_feedbacks/` of the main checkout, to be
filed once approved. Our own format and conventions stay here.
