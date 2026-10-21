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
  - `lint/` checks a note against the site's rules (see Lint below).
- `src/`: the React UI.
  - `api/` holds the clients for the server.
  - `editor/` is the note editor: Visual and Source modes, save status and
    the conflict dialog.
  - `frontmatter/` reads and writes a note's YAML frontmatter and holds the
    form.
  - `lint/` is the Issues tab and the issue count in the toolbar.
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
| `POST /api/lint` | Takes JSON `{ path, content }` for a note and returns `{ path, issues }` (see Lint). Writes nothing. |
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

- **Visual** edits blocks in place and looks like the note page: the
  frontmatter title and description on top (a click opens the panel's
  Frontmatter tab), the site's prose, callouts, code frames, keywords and accordions
  (see Plugins). Type `/` for the block and component menu. Blocks you don't
  touch are written back byte for byte. Syntax that no plugin understands
  shows as source and still round-trips.
- **Source** is CodeMirror 6 over the whole MDX file. Text that does not parse
  stays in Source until it is fixed.
- **Frontmatter** (a tab of the side panel) edits title, description, visible and
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
  `--fde-*` tokens in `src/notes-theme.css`, next to the site tokens the
  components draw with (`--garden-*`, `--color-graph-*`, `--color-callout-*`);
  a test fails when they drift. `src/notes-prose.css` copies the note page's
  prose rules (`app/notes/notes.module.css`).

## Lint

The side panel has two tabs, Frontmatter and Issues; below 1024px it is a
drawer opened from the header's Panel button. Issues lists what the site
would get wrong in the open note, checked about 400ms after typing stops and
again when another file changes on disk. The toolbar shows the count;
picking an issue opens Source with the problem selected and marked.

The rules live in `server/lint/` and follow what the site does, not a style
guide: the site turns many mistakes into plain text or a placeholder instead
of failing the build.

| Rule | Level | Reports |
| --- | --- | --- |
| `directive-unknown` | error | A container or leaf directive the site does not render, a text directive with a label or attributes that it does not render (`:keywrod[Map]`; a bare `a:b` is fine), a `:::tab` with no value or label |
| `directive-unclosed` | error | A container with no closing fence of its own |
| `directive-nesting` | error | A nested container with as many colons as its parent, and a fence left with nothing to close |
| `callout-type` | error | `<Callout type>` outside the site's list |
| `accordion-kind` | error | `kind` of `:::accordion` or `<Accordion>` outside the site's list |
| `link-broken` | error | A `./` or `../` link that reaches no note, resolved like `source.resolveHref` (as a file next to the note, then as a URL against the page), and `/notes/…` links with no page |
| `asset-missing` | error | `src` of `HtmlEmbed`, `SvgDiagram`, `::html`, `::svg`, `::diagram`, or a `/…` image, that is not a file in `public/` (a URL such as `https://…` included: the site only reads `public/`) |
| `graph-id-duplicate` | error | Two sections with one id in a note: `GraphMeta`, `:graph-meta`, `SectionTitle`, `GraphSection`, or any marker with `graphType`/`graphKind="section"`. Keywords may reuse a section's id, and the same id on two notes is how the graph links them. |
| `graph-meta-incomplete` | error, warning | A marker with no `id`, a Keyword, Tag or SectionTitle with no `displayName` (the graph drops it); a warning for GraphMeta with no `displayName`, since the heading text stands in |
| `mdx-parse` | error | The note does not parse |

Code blocks and inline code are never checked. Directive names, callout
types and accordion kinds come from `lib/notes-syntax.ts`, the same lists the
site's directive plugin and components use, so the two cannot drift.

`npm run studio:lint` (from the repo root) lints every note and exits 1 on
an error; `tests/server/lint/notes.test.ts` keeps the whole of
`content/notes` at zero issues.

## Plugins

What the editor understands comes from plugins in `src/plugins/<name>/`. The
registry (`src/plugins/registry.ts`) finds every `index.ts` or `index.tsx`
there, so adding a plugin needs no change anywhere else.

```ts
// src/plugins/svg-diagram/index.ts, shortened
import type { UiComponentSpec } from '@fumadocs-editor/ui';
import { definePlugin } from '../plugin';
import './svg-diagram.css'; // the plugin's own styles
import { SvgDiagram } from './SvgDiagram'; // React components in their own file

const svgDiagramSpec: UiComponentSpec = {
  name: 'SvgDiagram', // the JSX tag
  attributeRegions: [{ attribute: 'caption', region: 'caption' }],
  props: [{ name: 'src', type: 'string' }, { name: 'label', type: 'string' }],
  render: SvgDiagram,
};

export default definePlugin({ id: 'svg-diagram', components: [svgDiagramSpec] });
```

- `components` are `UiComponentSpec`s: how a component's attributes and
  children map to editable regions and props, how it renders, and what the
  slash menu inserts. Only add components the site renders
  (`components/mdx.tsx`).
- `syntax` turns on parse-level dialects such as `directives`.
- `decorate` draws over what the editor keeps as source (inline JSX tags,
  text directives, verbatim blocks) with ProseMirror decorations. It changes
  how the document looks, never the document. `src/editor/decorations.ts`
  puts every plugin's decorator on the live editor (`MdxEditor.Root` takes no
  extra extensions, so it is registered on the TipTap editor itself). Cards
  share `src/plugins/cards.css`; `.studio-hidden` hides the source a card
  covers.
- Two plugins may not share an `id` or define the same component.
- `tests/src/plugins/round-trip.test.ts` parses and writes back every note
  with all plugins loaded and fails if a byte changes. Put sample MDX for a
  new component in `src/plugins/<name>/fixtures/*.mdx` to add it to that test.

Plugins today:

- `callout`: `<Callout>` and `:::type[title]` drawn like
  `components/notes-callout.tsx`, with the site's types and an icon menu to
  change them. The editor only parses the admonition names in core's
  `ADMONITION_TYPES`, so the plugin adds the site's own (`example`,
  `caution`, `important`, `error`, from `lib/notes-syntax.ts`) to
  that object at load; `tests/src/plugins/callout.test.ts` fails if a new
  editor version stops reading it. A callout whose title has formatting, or
  that holds an accordion group, stays source (the editor's rule).
- `graph-objects`: `<Keyword>`, `<Tag>`, `:keyword[…]` and `:tag[…]` in the
  keyword style, `<GraphMeta/>` and `:graph-meta{…}` as a small marker, all
  as decorations: with the caret inside (or the atom selected) the source
  shows again. `<SectionTitle>` is a component.
- `site-directives`: `::::accordions` groups as the site's accordion cards
  (the body opens as MDX source and is written back on blur) and
  `::youtube` as a card. The MDX button shows the block's source.
- `fumadocs-ui`: Cards, Steps, Tabs and Accordions.
- `html-embed` and `svg-diagram`: cards. `SvgDiagram` shows a file under
  `public/notes` through the file API and reads its props like the site
  (`lib/mdx-props.ts`); a bare JSX boolean (`plate`) reaches the editor
  without a value, so write `plate="true"` to see it. `HtmlEmbed` shows no
  live page, since the file API serves HTML assets sandboxed without
  scripts.

## Checks

```sh
npm --prefix tools/notes-studio test
npm --prefix tools/notes-studio run lint   # strict typescript-eslint + React hooks
npm --prefix tools/notes-studio run types:check
```
