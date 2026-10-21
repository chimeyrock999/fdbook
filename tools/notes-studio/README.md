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

**Open on site** in the header opens the note's page on the site's dev server
(`npm run dev` at the repo root, `http://localhost:3000` unless
`STUDIO_SITE_URL` says otherwise). The Studio does not start the site (#43).

The Studio replaces the Chimey Notes Obsidian plugin, removed in #44. Its
checks that the site gets wrong live on in Lint, its JSX snippets, graph
markers and directive blocks in the `/` menu and the graph bar (see Graph
markers), creating pages and editing `meta.yaml` come with the page tree (#11). A
checkout that built the plugin keeps its untracked `obsidian-plugin/`
(`node_modules`, `dist`) after pulling; remove it with `rm -rf obsidian-plugin`.

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
  - `tree/` builds the page tree and creates, renames and reorders pages
    (see Page tree below).
- `src/`: the React UI.
  - `api/` holds the clients for the server.
  - `editor/` is the note editor: Visual and Source modes, save status and
    the conflict dialog.
  - `frontmatter/` reads and writes a note's YAML frontmatter and holds the
    form.
  - `lint/` is the Issues tab and the issue count in the toolbar.
  - `media/` saves pasted and dropped images under `public/notes` (see
    Images below).
  - `notes/` is the check that a note can be opened.
  - `sidebar/` is the left sidebar: the activity bar (Notes, Issues), its
    width and whether it is shown.
  - `tree/` is the page tree in the Notes view and its dialogs.
  - `graph/` wraps text as graph markers and edits their ids (see Graph
    markers).
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
| `GET /api/tree` | The page tree: `{ tree }` (see Page tree) |
| `POST /api/tree` | Takes JSON `{ op: "create" \| "rename" \| "move", dryRun?, … }`, changes the tree and returns `{ changes, open }`. With `dryRun` it writes nothing. |
| any other `/api/…` | `404` with a JSON `{ error }`, never the app's page (see below) |
| `/__fde_sync` (websocket) | The fumadocs-editor sync server for `content/notes`. It reads `.mdx` only, writes only notes that already exist (no page or folder creation; that goes through the file API), and merges changes made on disk into open documents. Known gap: its tree `delete` command still removes an existing note, without updating `meta.yaml` or checking the mtime, because the scope cannot tell it apart from a save on the same path. Don't wire the editor's tree delete until upstream can authorize tree commands separately (fuma-nama/fumadocs-editor#24). |

A Studio server keeps the code it started with, while the page reloads with
every update. A server started before an update that added an endpoint used
to answer it with the app's `index.html`; the API clients
(`src/api/json.ts`) now say to restart `npm run studio` when an endpoint
answers with a page instead of JSON.

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

Pick a note in the page tree (or open `?path=content/notes/…mdx`). The editor is
[fumadocs-editor](https://github.com/fuma-nama/fumadocs-editor), opened
through the notes sync socket:

- **Visual** edits blocks in place and looks like the note page: the
  frontmatter title and description on top, the site's prose, callouts, code
  frames, keywords and accordions (see Plugins). Type `/` for the block and
  component menu. Blocks you don't touch are written back byte for byte.
  Syntax that no plugin understands shows as source and still round-trips.
- **Source** is CodeMirror 6 over the whole MDX file. Text that does not parse
  stays in Source until it is fixed.
- **Frontmatter** is edited at the top of the note in Visual. The title and
  description are typed in place (Enter moves on to the next line, then the
  body). The strip under them sums up the rest (icon, Hidden, graph id,
  keyword and section counts, errors) and opens to edit it: the icon, from
  the lucide names the site knows (`lib/notes-icons.ts`); whether the page
  is shown on the site (off writes `visible: false`); the graph's id and
  displayName; keywords as chips; sections with their keywords. Other keys
  show read-only. Every change is checked against `notesPageSchema`
  (`lib/notes-schema.ts`), written only when it passes, and the issues show
  next to the field. Only the edited values change; comments, key order,
  quoting and other keys stay. A locked note shows it read-only. Visual hides
  the YAML block; Source shows it.
- **Saving** is automatic: edits go to the file in the worktree (no commit).
  `Cmd/Ctrl-S` saves at once. Changes made on disk (Obsidian, an agent) are
  merged into the open note. If the same block changed on both sides, a
  dialog asks which version to keep.
- Light and dark follow the system. Colours and fonts are the notes site's
  (`.notes-theme` in `app/notes/notes.css`), copied onto the editor's
  `--fde-*` tokens in `src/notes-theme.css`, next to the site tokens the
  components draw with (`--garden-*`, `--color-graph-*`, `--color-callout-*`);
  a test fails when they drift. `src/notes-prose.css` copies the note page's
  prose rules (`app/notes/notes.module.css`). The editor's block drag handle
  is drawn as a grip (`src/editor/drag-handle.css`, found by its
  `aria-label`; `tests/src/editor/drag-handle.test.ts` fails if a new editor
  version changes it).

## Sidebar

The left side works like VS Code's. The activity bar holds the **Notes**
view (the page tree) and the **Issues** view (the open note's lint issues,
with their count on the icon); picking the open view again hides the
sidebar, and so does the button at the foot of the bar. Drag the sidebar's
right edge to resize it (220–480px), or focus the edge and use the arrow
keys, Shift for bigger steps, Home and End for the limits; double-click
resets it to 284px. It never takes more than the window leaves the editor
(420px); resizing starts from the width it shows. The view, the width and
whether it is shown are kept in localStorage. Below 768px the sidebar is a
drawer, opened from the header's Notes button or the toolbar's issue count,
and its view takes up to 320px.

## Graph markers

The graph markup of `components/graph-objects.tsx` is inserted and edited in
Visual:

- The `/` menu inserts a Keyword or Tag (`<Keyword id="" displayName="">`),
  a Graph heading (`### Title :graph-meta{…}`) and the site's directive
  blocks: accordions, tabs, steps and `::youtube`, next to the JSX
  components (`<YouTube>` among them).
- Select text and the graph bar under it wraps it as a **Keyword**
  (`Mod-Alt-K`) or **Tag** (`Mod-Alt-T`). With the caret in a heading,
  **Graph node** (`Mod-Alt-G`) adds `:graph-meta{…}` from its title. Some
  systems take a shortcut before the page sees it (`Ctrl-Alt-T` opens a
  terminal on GNOME, `Cmd-Opt-K` the Firefox console on macOS); the bar
  buttons work everywhere. The bar and the id fields are placed with
  floating-ui against the box around the selection and the editor's own
  format bar, which also sits under the selection: under that box, or above
  it with no room left in the editor (`src/graph/dock.ts`). The editor has no way to add buttons to
  its format bar yet; one bar is drafted as an upstream request.
- The id is slugged from the text (Vietnamese marks dropped, `đ` → `d`) and
  the displayName is the text. The fields open right after, and again from
  **Edit … id** on the bar (caret in a keyword or a marked heading) or a
  click on a graph node marker or a `:keyword[…]` label. Change the text, id
  or displayName; Enter or a click elsewhere writes them, Escape leaves the
  marker as it is. A marker without an id (just inserted from `/`) opens
  them when the caret reaches it, and takes its id from the text as you
  type it.
- Only the marker's own source changes. Keyword text with mixed formatting,
  or a `:keyword[…]` label with Markdown in it, is kept as it is; the fields
  then change only the id and displayName. A label typed in the fields is
  written with its Markdown and MDX characters escaped (`\*`, `` \` ``,
  `\[`, `\{`, `\<`), so the site shows it as typed. A value with both `"` and `'` is saved with its
  `"` turned into `'`.

## Page tree

The Notes view shows the notes as the site's sidebar does. The server runs
the same fumadocs `loader()` as `lib/source.ts` over `content/notes`
(`server/tree/build.ts`), so the order, separators (`---Label---`), links,
nested entries (`a/b`), `...`, `z...a`, `...folder` and `!slug` all come out
as on the site. On top of that the tree shows:

- **hidden**: pages and folders the site leaves out of its sidebar, in their
  own folder after the listed ones. Either no meta.yaml lists them (fumadocs'
  fallback tree) or they say `visible: false` (`lib/visible-page-tree.ts`).
  Hover the badge for the reason.
- **missing**: a `pages` entry that reaches no page or folder, at its place.
- **Filter** keeps the pages and folders whose title or path matches, with
  the folders on the way to them.
- Folders start closed, apart from the ones on the way to the open note, and
  the tree remembers which ones you opened. meta.yaml's `defaultOpen` is for
  the site's sidebar and is not read here: most folders set it, so the whole
  tree would open at once.
- Rows follow the site's sidebar: 34px high, 14px text, a guide line for
  each nested level.

Changes go through `POST /api/tree`, never through the notes sync, which
cannot update meta.yaml. Each one is planned against the disk and applied
under one lock. Every file it writes must still have the mtime it was read
at, checked before anything is written and again just before each write;
otherwise the answer is `409`. A rename moves the page or folder first, so
a move that fails writes nothing.

- **Reorder** (drag a row, or the row menu's Move up / Move down) moves an
  entry within its folder's `pages`. Only nodes with an entry of their own
  there can move; a lock explains the others. The edit swaps the text of the
  entry lines, so comments, blank lines, quote style, `icon`, `visible` and a
  missing final newline stay as they were. A folder without meta.yaml gets
  one with only `pages`, in the new order, so its title (from the index
  page) and its closed-by-default state stay.
- **New page** (the `+` button, or New page here / below in the row menu)
  writes `slug.mdx`, or `slug/index.mdx` plus `slug/meta.yaml`, with the
  frontmatter the notes use (title, description, graph), as the Obsidian
  plugin wrote it. The slug is added to the parent's `pages` after the
  chosen entry, unless the parent has no meta.yaml, no `pages`, or
  `...`/`z...a`, which list it already.
- **Rename** gives a page or folder a new name in the same folder. Every
  meta.yaml entry that reached it (`a/b`, `!x`, `...x` included) and every
  Markdown link or link definition to it (`./`, `../` and `/notes/…`, anchors
  kept) points at the new name; only the changed path segment is rewritten.
  Only links that reach a note change: `/notes/a/page/x.png` (an image in
  the page's asset folder, which does not move) and a folder `page/` next
  to `page.mdx` keep their paths. JSX `href`s are not rewritten. A note open
  in the editor follows the rename; renaming it, or its folder, waits until
  its edits are saved. The dialogs show what will be written (a dry run)
  before you confirm.

A rename does not move the page's images: they stay in
`public/notes/<old path>/`, the links to them keep working, and the dry run
lists the folder as staying. New images go to the folder of the new path
(see Images). Rename and reorder do
not cover moving a page to another folder, deleting, or editing a folder's
title, icon or `defaultOpen`.

## Images

Paste or drop an image in Visual, pick one from the `/` menu's Image item, or
use Upload on a selected image's toolbar. A dialog asks for the file name
first: the image's own name in kebab-case ASCII is offered, selected, and the
extension stays as it is. A name already used in the page's folder cannot be
saved, and Escape or Cancel writes nothing.

- The file goes to the page's folder under `public/notes`:
  `content/notes/a/b.mdx` uses `public/notes/a/b/`, and a folder's
  `index.mdx` uses the folder (`public/notes/a/`).
- The note gets `![alt](/notes/a/b/name.png)`, the path the site reads; the
  editor fills the alt text from the original file name, so edit it in the
  image toolbar. The editor shows `/notes/…` images through the file API.
- The dialog keeps the focus while it is open: the editor inserts the image
  where the caret was when it was pasted, so the note should not change
  meanwhile.
- Only images the site serves are saved (PNG, JPEG, WebP, GIF, AVIF, SVG, up
  to 25 MB); anything else is refused with a notice beside the save status.
  The save is a new file only, so a name taken meanwhile is refused, never
  overwritten.
- In Source, typing `src="` or an image's `](` suggests the assets under
  `public/notes`, those of the open page first. `HtmlEmbed` and `::html`
  suggest `.html` files, `SvgDiagram`, `::svg` and `::diagram` suggest `.svg`,
  images suggest images. The page's own folder ranks first, then the folder
  the note sits in, where many notes keep their assets.

Renaming or deleting an existing asset is not supported yet.

## Lint

The sidebar's Issues view (see Sidebar) shows what the site would get wrong
in the open note, checked about 400ms after typing stops and again when
another file changes on disk. The toolbar shows the count and opens the
view; picking an issue opens Source with the problem selected and marked,
or, for one inside the frontmatter, focuses its field at the top of the
note.

The rules live in `server/lint/` and follow what the site does, not a style
guide: the site turns many mistakes into plain text or a placeholder instead
of failing the build.

| Rule | Level | Reports |
| --- | --- | --- |
| `directive-unknown` | error | A container or leaf directive the site does not render, a text directive with a label or attributes that it does not render (`:keywrod[Map]`; a bare `a:b` is fine), a `:::tab` with no value or label |
| `directive-unclosed` | error | A container with no closing fence of its own |
| `directive-nesting` | error | A nested container with as many colons as its parent, and a fence left with nothing to close |
| `callout-type` | error | `<Callout type>` outside the site's list |
| `callout-style` | error | `<Callout style="…">` as a string: the site only reads a `style` object, so the string sets nothing (use `type` for the look) |
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
  and `::youtube` as a card. On an accordion card the icon picks the item's
  `kind` (from `ACCORDION_KINDS`), the title is edited in place on the head,
  and the body opens as MDX source. Each is written back as typing pauses,
  like any other edit, and rewrites only its own line or lines: a kind or
  title keeps its quotes and its place, a title written as the `[label]`
  stays there, and an empty title is not written. Titles show the text the
  site shows (character references and label escapes decoded) and are
  written so they read back the same. The MDX button shows the block's
  source.
- `site-inserts`: the `/` menu items for graph markers and directive
  blocks. The menu lists components, so each is a spec named
  `studio-insert-…` whose `insert` returns the site's syntax instead of a
  node of its own; no note has such a tag, and
  `tests/src/plugins/site-inserts.test.ts` checks that none parses.
- `youtube`: `<YouTube>` as the same card as `::youtube`, its title edited in
  place and its url in the props panel.
- `fumadocs-ui`: Cards, Steps, Tabs and Accordions.
- `html-embed` and `svg-diagram`: cards. `SvgDiagram` shows its inline
  `svg` (as an image, so no script runs) or else a file under `public/notes`
  through the file API, and reads its props like the site
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
