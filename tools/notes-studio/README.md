# Notes Studio

Local editor for `content/notes` (see #23). It runs on `127.0.0.1` only and is
not part of the site build: `tools/` is excluded from the site's TypeScript,
ESLint and Tailwind sources.

## Run

From the repo root, after the root `npm install`:

```sh
npm run studio:install   # once, installs this package's dependencies
npm run studio           # http://127.0.0.1:4310
```

Set `STUDIO_PORT` to use another port. Needs Node 22.18 or newer (the server
runs TypeScript directly).

## Layout

- `server/`: one Node process on one origin.
  - `index.ts` is the entry point; it checks the dependencies are installed.
  - `studio-server.ts` puts the pieces together: it binds the port and mounts
    Vite and the handlers below.
  - `config.ts` holds the host, the port and the root paths.
  - `routing.ts` runs the guard on every request and upgrade, then hands the
    request to a handler.
  - `http.ts` holds small HTTP helpers.
  - `security/` has the Host/Origin guard and the path policy.
  - `files/` has the file API, the file events and the file-system helpers.
  - `sync/` has the fumadocs-editor sync server for `content/notes`.
- `src/`: the React UI.
  - `api/` holds the clients for the server.
  - `editor/` is the note editor: Visual and Source modes, save status and
    the conflict dialog.
  - `frontmatter/` reads and writes a note's YAML frontmatter and holds the
    form.
  - `notes/` is the note list and the check that a note can be opened.
  - `plugins/` holds the editor plugins (see below).
- `tests/`: laid out like `server/` and `src/`. `tests/support/` holds the
  fixtures: a throwaway worktree, a Studio on a free port, and raw HTTP and
  websocket helpers.
- Shared code from the site is imported as `@site/...`, for example the notes
  frontmatter and `meta.yaml` schemas in `@site/lib/notes-schema`.

## Server

Everything the server touches goes through two checks.

- **Origin guard** (`server/guard.ts`). Every request and every websocket
  upgrade must carry `Host: 127.0.0.1:<port>` or `localhost:<port>`, which
  stops DNS rebinding. If it sends `Origin` or `Sec-Fetch-Site`, they must be
  this origin. Requests without them (curl, agents) pass on Host alone. A
  websocket upgrade that is neither Vite HMR nor the notes sync is closed.
- **Path policy** (`server/paths.ts`). Paths are relative to the worktree, in
  posix form. Only `content/notes/**/*.mdx`, `content/notes/**/meta.yaml` and
  assets under `public/notes/` (png, jpg, jpeg, gif, webp, avif, svg, html,
  glb, pdf) are allowed. `..`, empty segments and hidden segments such as
  `.obsidian` are refused, and so is any symlink on the path, even one that
  points inside: a save replaces the file, so it would turn a linked note into
  a copy. The file API, the file events and the notes sync all use this check.

The worktree is this checkout for now; `startStudioServer({ root })` takes
another one.

| Endpoint | What it does |
| --- | --- |
| `GET /api/files` | Lists the editable files: `{ files: [{ path, kind, mtimeMs }] }` |
| `GET /api/file?path=…` | Notes and `meta.yaml` come back as `{ path, content, mtimeMs }`. Assets come back as bytes with an `X-Mtime` header. |
| `PUT /api/file?path=…` | Notes and `meta.yaml` take a JSON body `{ content, baseMtime }`. Assets take the raw bytes plus `X-Studio-Write: 1` and `X-Base-Mtime`. |
| `GET /api/events` | Server-sent events: `{ type: "add" \| "change" \| "unlink", path, mtimeMs }` |
| `/__fde_sync` (websocket) | The fumadocs-editor sync server for `content/notes`. It reads `.mdx` only, writes only notes that already exist (no page or folder creation; that goes through the file API), and merges changes made on disk into open documents. Known gap: its tree `delete` command still removes an existing note, without updating `meta.yaml` or checking the mtime, because the scope cannot tell it apart from a save on the same path. Don't wire the editor's tree delete until upstream can authorize tree commands separately (fuma-nama/fumadocs-editor#24). |

A save names the mtime it was edited from; `null` means a new file. If the
file changed on disk since then, for example in Obsidian or by an agent, the
server writes nothing. It answers `409` with the disk version
`{ content, mtimeMs }` (`null` if the file was deleted). Retry with that
`mtimeMs` to keep your version. Writes are atomic: the server writes a hidden
temp file and renames it over the target, keeping the file's mode.

`src/api/files.ts` is the UI client. `writeFile` throws a
`FileConflictError` that holds the disk version. `subscribeFileEvents` follows
`/api/events`.

## Editor

Pick a note in the list (or open `?path=content/notes/…mdx`). The editor is
[fumadocs-editor](https://github.com/fuma-nama/fumadocs-editor), opened
through the notes sync socket:

- **Visual** edits blocks in place. Type `/` for the block and component menu.
  Blocks you don't touch are written back byte for byte. Syntax that no
  plugin understands (inline `<GraphMeta>` and `<Keyword>`, `:::example`,
  `:::accordion`, `:keyword[…]`) shows as source and still round-trips.
- **Source** is CodeMirror 6 over the whole MDX file. Text that does not parse
  stays in Source until it is fixed.
- **Frontmatter** (the side panel) edits title, description, visible and
  graph. Every change is checked against `notesPageSchema`
  (`lib/notes-schema.ts`) and written only when it passes. Only the edited
  values change; comments, key order, quoting and other keys stay. Visual
  hides the YAML block; Source shows it.
- **Saving** is automatic: edits go to the file in the worktree (no commit).
  `Cmd/Ctrl-S` saves at once. Changes made on disk (Obsidian, an agent) are
  merged into the open note. If the same block changed on both sides, a
  dialog asks which version to keep.
- Light and dark follow the system. Colours and fonts are the notes site's
  (`.notes-theme` in `app/notes/notes.css`), copied onto the editor's
  `--fde-*` tokens in `src/notes-theme.css`; a test fails when the two drift.
  Components still use the editor's own look (#35).

## Plugins

What the editor understands comes from plugins in `src/plugins/<name>/`. The
registry (`src/plugins/registry.ts`) finds every `index.ts` or `index.tsx`
there, so adding a plugin needs no change anywhere else.

```ts
// src/plugins/svg-diagram/index.ts
import type { UiComponentSpec } from '@fumadocs-editor/ui';
import { definePlugin } from '../plugin';
import { SvgDiagramCard } from './SvgDiagramCard'; // React components in their own file

const svgDiagramSpec: UiComponentSpec = {
  name: 'SvgDiagram', // the JSX tag
  attributeRegions: [{ attribute: 'caption', region: 'caption' }],
  props: [{ name: 'src', type: 'string' }, { name: 'label', type: 'string' }],
  render: SvgDiagramCard,
};

export default definePlugin({ id: 'svg-diagram', components: [svgDiagramSpec] });
```

- `components` are `UiComponentSpec`s: how a component's attributes and
  children map to editable regions and props, how it renders, and what the
  slash menu inserts. Only add components the site renders
  (`components/mdx.tsx`).
- `syntax` turns on parse-level dialects such as `directives`.
- Two plugins may not share an `id` or define the same component.
- `tests/src/plugins/round-trip.test.ts` parses and writes back every note
  with all plugins loaded and fails if a byte changes. Put sample MDX for a
  new component in `src/plugins/<name>/fixtures/*.mdx` to add it to that test.

Plugins today: `fumadocs-ui` (Callout, Cards, Steps, Tabs, Accordions),
`admonition` (`:::note`, `:::info`, `:::tip`, `:::warn`, `:::warning`,
`:::danger`, `:::success`) and `html-embed`.

## Checks

```sh
npm --prefix tools/notes-studio test
npm --prefix tools/notes-studio run lint   # strict typescript-eslint + React hooks
npm --prefix tools/notes-studio run types:check
```
