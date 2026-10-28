# How the Studio is built

Read this to change the Studio: where each part lives, the checks every
request goes through, the HTTP API, how change requests sit on git, and how
agents, the MCP server and the editor plugins are wired. What each feature
does for the person using it is in [using.md](using.md).

- [Layout](#layout)
- [Request checks](#request-checks)
- [Sign-in and sessions](#sign-in-and-sessions)
- [HTTP API](#http-api)
- [Saving files](#saving-files)
- [Notes sync](#notes-sync)
- [Connection watch](#connection-watch)
- [Change requests and git](#change-requests-and-git)
- [Page tree and asset changes](#page-tree-and-asset-changes)
- [Agents](#agents)
- [MCP server](#mcp-server)
- [Proposals](#proposals)
- [The site's look](#the-sites-look)
- [Plugins](#plugins)
- [Write actions](#write-actions)

## Layout

One Node process on one origin serves the API, the notes sync socket and
the React app through Vite.

- `server/`
  - `index.ts` is the entry point; it checks the dependencies are installed
    (`deps.ts`) before anything else loads.
  - `studio-server.ts` puts the pieces together: it binds the port, mounts
    Vite, the MCP server and the handlers below, and serves each change
    request's workspace under `/cr/<slug>/`.
  - `workspace.ts` holds the handlers of one worktree: files, events, sync,
    lint, tree, assets, changes, diff and history, preview and publish,
    agent chats and their context, proposals and comments.
  - `config.ts` holds the host, the port, the root paths and the other
    `STUDIO_*` settings (see [setup.md](setup.md#other-settings)).
  - `routing.ts` runs the guard on every request and upgrade, then hands
    the request to a handler. `http.ts` holds small HTTP helpers.
  - `security/` has the Host/Origin guard (`guard.ts`), the path policy
    (`paths.ts`, `asset-types.ts`) and the role each request needs
    (`access.ts`).
  - `auth/` is sign-in with GitHub: settings, the device and web flows, the
    roles read with gh, the sessions.
  - `files/` has the file API, the file events and the file store.
  - `sync/` is the fumadocs-editor sync server for `content/notes`.
  - `lint/` checks a note against the site's rules, and its CLI (see
    [lint.md](lint.md)).
  - `tree/` builds the page tree and creates, renames, reorders, hides and
    shows pages.
  - `assets/` finds where notes use the files under `public/notes` and the
    diagram sources that generate them, and renames, replaces and deletes
    them.
  - `markdown/` parses link destinations, shared by the tree and asset
    rewrites.
  - `icons/` lists the lucide names a note's `icon` can take.
  - `cr/` has the change requests: branches, worktrees, statuses, drift
    from main, discard.
  - `git/` reads `git status` and the change request's commits, commits
    picked files, reads a file as main holds it, and reads, compares and
    restores a file's versions and deleted pages.
  - `preview/` pushes a change request, reads its Cloudflare build check
    and its pull request, and publishes it.
  - `agents/` runs chats with agents over ACP in a change request, with
    their context, file policy, transcripts and per-turn changes.
  - `mcp/` is the Studio's MCP server: its HTTP endpoint, the note,
    writing and diagram tools, the grants, and the stdio bridge.
  - `proposals/` keeps the edits agents propose and the comments they
    leave, per change request.
- `src/`: the React UI.
  - `api/` holds the clients for the server; `workspace.ts` says which
    worktree the page edits (`?cr=`).
  - `session/` is the sign-in gate and page, the user menu, and what each
    role may do.
  - `cr/` is the change request picker, the Edit menu, their dialogs, the
    list page and the notice on top of the Changes view.
  - `editor/` is the note editor: Visual and Source modes, save status, the
    conflict dialog, unsaved edits kept per tab, Source's asset completion.
  - `frontmatter/` reads and writes a note's YAML frontmatter and holds the
    form.
  - `lint/` is the Issues view and the issue count in the toolbar.
  - `media/` saves pasted and dropped images under `public/notes`.
  - `notes/` is the check that a note can be opened, and the header's Open
    preview button.
  - `sidebar/` is the activity bar and the sidebar, its width and whether
    it is shown.
  - `tree/` is the page tree in the Notes view and its dialogs.
  - `assets/` is the Assets view, the asset page and its dialogs.
  - `diagrams/` is the diagram editor: the page and canvas
    (`DiagramPage.tsx`, `DiagramCanvas.tsx`), the panel (`DiagramPanel.tsx`),
    where a copy goes (`placement.ts`), the sequence and lifecycle canvases
    and panels (`SequenceCanvas.tsx`/`SequencePanel.tsx`,
    `LifecycleCanvas.tsx`/`LifecyclePanel.tsx`), and saving
    (`useDiagramFile.ts`).
  - `changes/` is the Changes view, the suggested commit message, the
    Preview and Pull request sections, the Publish dialog, the header's
    main action, the change marks on the page tree and the reminder on
    leaving a change request.
  - `diff/` is a file's diff against main; its block alignment is shared
    with proposals.
  - `history/` is a note's or an asset's history, and the deleted pages.
  - `graph/` wraps text as graph markers and edits their ids.
  - `agents/` is the header's agent control, the agent panel, the actions,
    the chat history, agent replies as markdown and the Connect an agent
    dialog; `logos/` holds each agent's mark with its source in the file.
  - `suggestions/` shows agents' proposals and comments in the editor.
  - `actions/` is what every button that writes to the server uses (see
    [Write actions](#write-actions)).
  - `plugins/` holds the editor plugins (see [Plugins](#plugins)).
- `tests/`: laid out like `server/` and `src/`, plus `tests/lib/` for the
  site's `lib/`. `tests/support/` holds the fixtures, `tests/setup/` and
  `tests/global-setup.ts` the setup every run gets (see
  [checks.md](checks.md)).
- Shared code from the site is imported as `@site/...`, for example the
  notes frontmatter and `meta.yaml` schemas in `@site/lib/notes-schema`.

## Request checks

Everything the server touches goes through these checks.

- **Origin guard** (`server/security/guard.ts`). Every request and every
  websocket upgrade must carry `Host: 127.0.0.1:<port>` or
  `localhost:<port>` (with `STUDIO_HOST`, `<that address>:<port>`), which
  stops DNS rebinding. If it sends `Origin`, it must be this origin, and
  `Sec-Fetch-Site` must be `same-origin` or `none`. Requests without them
  (curl, agents) pass on Host alone. A websocket upgrade that is neither
  Vite HMR nor the notes sync is closed. The web sign-in's callback is the
  one cross-site page load let through: a `GET` with
  `Sec-Fetch-Mode: navigate` on that path.
- **Path policy** (`server/security/paths.ts`). Paths are relative to the
  worktree, in posix form. Only `content/notes/**/*.mdx`,
  `content/notes/**/meta.yaml`, assets under `public/notes/` (png, jpg,
  jpeg, gif, webp, avif, svg, html, glb, pdf) and diagrams,
  `diagrams/**/*.diagram.json` (not `diagrams/diagram.schema.json`), are
  allowed. `..`, empty segments and hidden segments such as `.obsidian` are
  refused, and so is any symlink on the path, even one that points inside:
  a save replaces the file, so it would turn a linked note into a copy. The
  file API, the file events, the notes sync and the MCP tools all use this
  check.
- **Role** (`server/security/access.ts`, `requiredRole`), when sign-in is
  on. After the guard, every `/api` request and the notes sync need a
  session with enough access, decided from the method and path alone, so a
  new write endpoint is closed until it is listed there:
  - `/api/session*` and `/api/mcp` need none (the MCP server checks its own
    bearer token);
  - `GET`, `HEAD`, `POST /api/lint` and `/api/mcp/tokens` need a reader;
  - a turn's `…/changes` (Keep/Revert) needs a writer;
  - everything else under `/api/agents/` needs an admin;
  - every other request needs a writer.

  Writes also carry the session's token in `X-Studio-Csrf`
  (`src/api/session.ts`, `studioFetch`), on top of the cookie and the
  origin guard.

## Sign-in and sessions

Settings and roles are in [setup.md](setup.md#sign-in); this is how they
are enforced (`server/auth/`).

- The session is a random id in an `HttpOnly`, `SameSite=Strict` cookie
  named after the port (browsers share cookies between the ports of one
  host). The server keeps only its hash, with the GitHub user, in
  `<STUDIO_HOME>/sessions-<port>.json` (mode `0600`). The web flow's state
  sits in a separate `studio_oauth_<port>` cookie (`SameSite=Lax`, path
  `/api/session`, 10 minutes), and the callback signs in only with the
  `state` the Studio set in this browser.
- The role is read with `gh api repos/<owner>/<repo>/collaborators/<login>/permission`
  and cached for five minutes; requests that need it together share one gh
  call. While gh cannot answer, requests answer `503`; the page and Vite's
  modules need no role and never wait for gh. That also means anyone who
  reaches the address can read the Studio's own code and what Vite serves
  from the repository (`lib/`, `components/`, `styles/`) before signing
  in; the notes and assets stay behind the gate.
- Once GitHub confirms a device code, a failure after it (gh down for the
  role) is retried on the next poll without a new code. At most 200
  sign-ins may be pending at once (`429` beyond).
- The notes sync checks on every document it opens and every write that
  its session still exists and its role allows it. Its socket is closed
  when the session signs out, and within 15 seconds once the session
  expired or the role fell below reader (while gh cannot answer, the last
  role read stands). The file events stream ends at its next event or
  heartbeat (every 25 seconds) once the session is gone.
- The page asks `GET /api/session` before it loads the Studio
  (`src/session/SessionGate.tsx`). Before each sync connection, reconnects
  included, it reads the session the browser holds now (`checkSeat` in
  `src/api/session.ts`) and refuses it unless it is the person the Studio
  runs for, so a sign-in in another tab never saves under another account.

## HTTP API

`npm run studio` serves main read only and each change request's worktree
under `/cr/<slug>/`. `startStudioServer({ root })` without
`changeRequests`, as the tests start it, edits the one worktree at `root`
instead and runs no agent.

JSON bodies need `Content-Type: application/json` (`415` otherwise) and are
capped (`413`):

- 5 MB for a file or a lint, 4 MB for an MCP request, 1 MB for a commit;
- 512 KB for anything sent to `/api/agents/conversations`;
- 64 KB for tree and asset operations;
- 16 KB for change requests, history restores and proposal decisions;
- 1 KB for sign-in, a push and `/api/mcp/tokens`;
- 6 × 60,000 + 4,096 bytes for a publish, room for a description at its
  limit however JSON escapes it.

Raw bodies are capped too: 25 MB for an asset, 10 MB for an attachment.

### Files, lint, tree, assets

| Endpoint | What it does |
| --- | --- |
| `GET /api/files` | Lists the editable files: `{ files: [{ path, kind, mtimeMs, size }] }` |
| `GET /api/file?path=…` | Notes, `meta.yaml` and diagrams come back as `{ path, content, mtimeMs }`. Assets come back as bytes with an `X-Mtime` header and `Content-Security-Policy: sandbox`. |
| `PUT /api/file?path=…` | Notes, `meta.yaml` and diagrams take a JSON body `{ content, baseMtime }`. Assets take the raw bytes plus `X-Studio-Write: 1` and `X-Base-Mtime` (empty: a new file). Answers `{ path, mtimeMs }`; see [Saving files](#saving-files). |
| `GET /api/events` | Server-sent events: `{ type: "add" \| "change" \| "unlink", path, mtimeMs }` |
| `POST /api/lint` | Takes `{ path, content }` for a note and returns `{ path, issues }` (see [lint.md](lint.md)). Writes nothing. |
| `GET /api/icons` | The lucide names a note's `icon` can take: `{ names }` |
| `GET /api/tree` | The page tree: `{ tree }` |
| `POST /api/tree` | Takes `{ op: "create" \| "rename" \| "move" \| "set-open" \| "visibility", dryRun?, … }`, changes the tree and returns `{ changes, open, created? }`. With `dryRun` it writes nothing. |
| `GET /api/assets` | Every file under `public/notes`, then every `diagrams/**/*.diagram.json`, with where notes use it (a diagram: the `<Diagram src>` that draw it) and the diagram sources that generate it: `{ assets: [{ path, mtimeMs, size, usages: [{ note, line, column, length, text, unsure }], sources: [{ path, line, text }] }] }` |
| `POST /api/assets` | Takes `{ op: "rename" \| "delete" \| "replace", path, name?, extension?, baseMtime, dryRun? }`, changes the asset and the notes that use it, and returns `{ changes, usages }`. A replace is a dry run only here. |
| `PUT /api/assets?path=…&extension=…&baseMtime=…` | Replaces the asset's content with the raw bytes (`X-Studio-Write: 1`, up to 25 MB), at its path or, with another extension, at its name with that one, and returns `{ changes, usages, mtimeMs }` |

### Changes, diff, history

| Endpoint | What it does |
| --- | --- |
| `GET /api/changes` | What `git status` says changed under `content/notes`, `public/notes` and `diagrams`, only files the path policy allows: `{ branch, files: [{ path, status: "M" \| "A" \| "D" \| "R", from? }] }` |
| `POST /api/changes` | Takes `{ message, paths }` and commits those files, and only them, on the worktree's branch; answers `{ sha, date, message, files: [{ status, path }] }`. Refuses an empty message, a path with no change, a merge in progress, and a branch named `main` or a detached HEAD; read-only main answers `403` first. |
| `GET /api/changes/history` | The change request's commits, newest first, no merges, up to 200: `{ base, commits }`, `base` being `origin/main`, else `main`, else `null` (no commits) |
| `GET /api/changes/diff?path=…[&from=…]` | The file against main: `{ path, from?, base, status: "same" \| "M" \| "A" \| "D" \| "R", before, after }`, each side `{ kind: "text", text, size }`, `{ kind: "binary", size }` (an asset that is not SVG or HTML, or text over 2 MB) or `null` where the file is missing. `base` is the merge base of `origin/main` (else `main`) and `HEAD`, or `null`; `from` reads main under a renamed file's old name. |
| `GET /api/changes/blob?path=…[&base=<sha>]` | The file's bytes as commit `base` (else the merge base now) holds it, for an image's before side in the diff and an older version's image in history; `404` when it has none. Served like an asset. |
| `GET /api/history?path=…` | `{ path, mtimeMs, deleted, generated, versions }`: `deleted` names the commit that deleted a file the worktree no longer has, `generated` whether a diagram source generates the asset |
| `GET /api/history/compare?path=&to=[&from=]` | Each a full sha or `now`; without `from`, nothing is before |
| `POST /api/history/restore` | `{ path, sha, mtimeMs }`, answers `{ path, mtimeMs }`, `path` being where the file is now; `409` when the file changed since its mtime |
| `GET /api/history/deleted` | `{ pages: [{ path, title, sha, date, author, message, folderGone }] }`, the latest 200 |
| `POST /api/history/restore-deleted` | `{ path, sha, dryRun? }`, answers `{ path, open, changes }`; `409` for a path the worktree has |

A sha must be one of the file's versions, and the path read at it comes
from git. History reads `git log --follow --cc --topo-order` on `HEAD`;
deleted pages read `git log -M --diff-filter=D` under `content/notes`.
Restores write under the notes lock; main and a reader answer `403`.

### Preview and publish

| Endpoint | What it does |
| --- | --- |
| `GET /api/preview` | `{ branch, blocked, pushed, unpushed, uncommitted, url, build, pr, prError }`, `build` being `{ state, logUrl, deploymentUrl, aliasUrl, at, error }` once pushed, `pr` the branch's pull request `{ number, url, state, title }` or null, `prError` why gh could not read it; main answers that it is read only |
| `POST /api/preview` | Takes `{}`, pushes the branch to origin and answers the preview. `409` when nothing was committed yet, when everything committed is pushed, when the worktree is blocked (main, a branch outside `cr/`), or when the remote branch has commits the change request has not (with git's reason); `502` when the push fails, `504` after 120 s; main answers `403` first. |
| `GET /api/publish` | The pull request's draft, `{ title, body }`: the branch's description (the change request's name), and its commits oldest first with the branch's preview link; `409` on main |
| `POST /api/publish` | Takes `{ title, body }`, pushes what is not pushed, opens the pull request and answers the preview. `400` for a title that is empty or over 256 characters or a description over 60,000; `409` with nothing committed or when the branch already has a pull request; `502` when gh cannot read the pull request or open one (a push already made stays); main answers `403` first. |

The push is `git push origin <HEAD>:refs/heads/cr/<slug>`
(`server/preview/preview.ts`), never forced; after it the server moves
`origin/cr/<slug>` itself with `git update-ref`. The build is the
`Cloudflare Pages` check run on the pushed commit, read with `gh api` from
origin's GitHub repository (`server/preview/check-runs.ts`) at most every 10
seconds per commit, and a finished one every minute (Cloudflare can retry a
build on the same commit). The 3 minutes before "No build" count from when
`origin/cr/<slug>` last moved in this clone (its reflog: the push, or the
fetch that saw a push made elsewhere). The fallback preview link is
`https://<alias>.<STUDIO_PAGES_PROJECT>.pages.dev`, the alias being the
branch slugged as Cloudflare does (`cr-<slug>`) and cut to 28 characters.

The pull request is read with `gh pr list --repo <origin> --head
cr/<slug> --state all` (`server/preview/pull-request.ts`; `--repo` only
when origin is on GitHub), the newest of this repository's winning, forks
left out (`gh pr view <branch>` would take a fork's pull request from a
branch of the same name). It is read at most every 15 seconds while there
is none or it is open, every minute once merged or closed, and again after
each push or publish. Publish runs `gh pr create --repo <origin> --base
main --head cr/<slug>` (`create` in `server/preview/pull-request.ts`,
called from `server/preview/publish.ts`).

### Change requests

| Endpoint | What it does |
| --- | --- |
| `GET /api/crs` | `{ enabled, crs: [{ slug, name, branch, status, pushed, worktree, changedPages, uncommitted, updatedMs, previewUrl, pr, stale, drift }], taken, prError, fetchError }`, `taken` being the slugs a new one cannot take and `drift` `{ behind, conflicts }` or null; `?fresh=1` fetches origin, checks main out again and reads the pull requests again |
| `POST /api/crs` | Takes `{ name }` (at most 80 characters, with a letter or digit), fetches origin, adds the branch and its worktree, and returns `{ cr }`; `502` when the fetch fails |
| `POST /api/crs/<slug>/discard` | Takes `{ dryRun?, seen? }` and returns `{ discard: { slug, branch, worktree, status, commits, unpushed, uncommitted, pushed, pr, closesPr, prError } }`. With `dryRun` it removes nothing; `seen` is what the dry run said about origin, and `409` answers when origin changed since. With sign-in on, removing what is on origin needs an admin (`403`). `404` for an unknown slug, `502` when gh or the remote delete fails. |

### Sign-in

| Endpoint | What it does |
| --- | --- |
| `GET /api/session` | `{ auth: "github" \| "off", flows, repo, user: { login, name, avatarUrl } \| null, role, csrf }`, or `503` when the role cannot be read. Sign-in off answers `auth: "off"` with every right. |
| `POST /api/session/device`, `POST /api/session/device/poll` | The device flow: `{}` answers `{ flow, userCode, verificationUri, expiresIn, interval }`; `{ flow }` answers `{ state: "pending", interval }` or `{ state: "done", session }` with the cookie, `410` once the code expired, `403` when GitHub cancelled it or the person has no access |
| `GET /api/session/web`, `GET /api/session/callback` | The web flow: a redirect to GitHub, and GitHub's redirect back, which signs in and goes on to `/` (or `/?signin_error=…`) |
| `POST /api/session/logout` | Takes `{}` and the csrf header, ends the session |

A flow that is not enabled answers `404`.

### Agents, proposals, MCP

| Endpoint | What it does |
| --- | --- |
| `GET /api/agents` | The agents this Studio knows and whether each can run: `{ agents }` |
| `GET /api/agents/totals` | Each change request's chats and cost (main's under `_main`): `{ totals }` |
| `GET`, `POST /api/agents/conversations` | Every chat, last active first; `POST { agent, role, prompt, context? }` starts one |
| `GET`, `DELETE /api/agents/conversations/<id>` | Its summary and events; deletes it (not during a turn) |
| `POST /api/agents/conversations/<id>/messages` | `{ prompt, context? }`: its next turn |
| `POST /api/agents/conversations/<id>/cancel` | `{}`: stops the turn going on |
| `POST /api/agents/conversations/<id>/permissions/<ask>` | `{ optionId }` answers a question (`null` rejects) |
| `GET`, `POST /api/agents/conversations/<id>/turns/<n>/changes` | The files turn n changed: `{ changes: [{ path, existed, decided, reason }] }`; `POST { path, op: "keep" \| "revert" }` decides one. A file changed since the turn ended is not reverted (`409`). |
| `GET /api/agents/conversations/<id>/turns/<n>/changes/before?path=…` | What the file held before the turn: `{ path, content }`, `null` when it did not exist |
| `GET /api/agents/events` | Server-sent events of every chat, numbered per chat (see [Agents](#agents)) |
| `GET /api/agents/mentions?q=…` | Notes, assets and other files of the worktree to mention (`git ls-files`, reused for 5 s; up to 50) |
| `POST /api/agents/attachments` | A document as the body, its name in `X-File-Name` (URI-encoded), up to 10 MB |
| `GET /api/proposals[?path=…]` | A change request's proposals (of one note), oldest first: `{ proposals }`, each `{ id, path, by, summary, createdMs, mtimeMs, stale, done, hunks: [{ id, removed, added, state, from, to }] }` |
| `GET /api/proposals/<id>` | `{ proposal }` |
| `POST /api/proposals/<id>` | `{ op: "accept" \| "reject" \| "rebase" \| "drop", hunks? }` (all undecided hunks by default), answers `{ proposal }`. A stale hunk is not accepted (`409`) until rebased. |
| `GET /api/proposals/events` | Server-sent events: each proposal when it is made or changes, and `comment` events |
| `GET /api/comments[?path=…]` | `{ comments: [{ id, path, block: { index, text } \| null, body, by, createdMs }] }` |
| `POST /api/mcp` | The MCP server, Streamable HTTP, stateless (see [MCP server](#mcp-server)). `GET` and `DELETE` answer `405`. |
| `POST`, `DELETE /api/mcp/tokens` | With sign-in on, makes an agent token for the signed-in person (`{ token }`), or ends all of theirs; any role, with the csrf header. Sign-in off answers `409`. |

Proposals and comments answer `409` on main to reads and event streams,
and their writes never get there: main answers `403` to every write but
`POST /api/lint` and the agent routes first. Agent chats work on main, read
only (see [Agents](#agents)); their Keep/Revert routes answer `409` to a
read and `403` to a decision.

### Under a change request

`/cr/<slug>/api/…` and `/cr/<slug>/__fde_sync` serve the workspace
endpoints above for the change request's worktree, so a page can only write
to the change request it shows (`server/workspace.ts`); `/api/crs`,
`/api/session*`, `/api/mcp` and `/api/mcp/tokens` are served only at the
root. An unknown slug answers `404`, and so does any other path under
`/cr/<slug>/`. Any other `/api/…` answers `404` with a JSON `{ error }`,
never the app's page, so a client that reaches an endpoint a running server
does not have yet says to restart it (`src/api/json.ts`).

## Saving files

A save names the mtime it was edited from; `null` means a new file. If the
file changed on disk since then (another editor, an agent), the server
writes nothing and answers `409` with the disk version `{ content, mtimeMs
}` (`null` if the file was deleted; always `null` content for an asset).
Retry with that `mtimeMs` to keep your version. Writes are atomic: the
server writes a hidden temp file and renames it over the target, keeping
the file's mode.

`src/api/files.ts` is the UI client. `writeFile` throws a
`FileConflictError` that holds the disk version. `subscribeFileEvents`
follows `/api/events`. A changed asset gets `&v=<mtime>` in its file API
URL (`src/api/asset-versions.ts`), from a write's answer or from the file
events, so images reload without a page reload.

## Notes sync

`/__fde_sync` (websocket) is the fumadocs-editor sync server for
`content/notes` (`server/sync/notes-sync.ts`). It reads `.mdx` only, writes
only notes that already exist (no page or folder creation; that goes
through the file API), and merges changes made on disk into open documents.
Page tree and asset changes never go through it, since it cannot update
`meta.yaml`.

Known gap: its tree `delete` command still removes an existing note,
without updating `meta.yaml` or checking the mtime, because the scope
cannot tell it apart from a save on the same path. Do not wire the editor's
tree delete until upstream can authorize tree commands separately
(fuma-nama/fumadocs-editor#24). The sync server has no write hook either,
so edits typed during an agent turn are not marked for that turn.

## Connection watch

The page's event streams (`/api/events`, `/api/proposals/events`,
`/api/agents/events`) and the notes sync are under one connection watch
(`src/api/connection.ts`), so a stopped server ends in one clear state
instead of every stream retrying forever.

- A dropped stream opens again after a second. One that fails 3 times in a
  row without staying open for 10 seconds, or is not open again 10 seconds
  after it dropped, means the server is gone.
- A stream the server refuses is asked again with a plain request to learn
  why. `401` (or `403`) is the sign-in, and the stream waits for it: it
  opens again once signed in, and meanwhile tries from 5 seconds, doubling
  up to a minute. `409` or `404` means the change request is closing or
  closed. A `5xx` counts as a failure (gh may be down only a moment), any
  other answer is shown as the server gave it, and no answer within 5
  seconds is a server that is gone.
- The notes sync counts as gone once it was offline for 10 seconds and
  the Studio does not answer `GET /api/session` either. A 2xx or an error
  of the Studio's own (`{ error }` in JSON, as the `503` while gh cannot
  read the role) is an answer, and the sync is checked again after another
  10 seconds; a network failure, or a proxy's or gateway's error for a
  Studio that stopped, is not.
- Then every stream and the sync are closed for good, so the page sends no
  more requests, and `src/session/ServerDisconnected.tsx` covers the page.
  A page leaving for another one shows nothing; one still there 10 seconds
  later, or back from the browser's back-forward cache, is watched again.

## Change requests and git

`server/cr/` keeps no state of its own: git holds everything.

- Main is a worktree of `origin/main` at `<STUDIO_HOME>/worktrees/_main`,
  checked out again at startup, on a fresh list and when a change request
  is created. Both fetch `main` and every `cr/*` branch from origin first,
  dropping the remote refs of branches deleted there; offline, startup
  reads the `origin/main` the clone has.
- A change request is branch `cr/<slug>` from `origin/main`, not tracking
  main so a push cannot land there, with its worktree at
  `<STUDIO_HOME>/worktrees/<slug>`. Its name is the branch description and
  its creation time a `studiocreated` key in the branch's config. A
  worktree removed by hand is pruned at startup (`git worktree prune`) and
  added again from the branch when the change request opens.
- The pull request statuses come from `gh pr list` (the newest 1000; one
  older shows as Previewing), read at most every 30 seconds.
- Drift from main is read with `git merge-tree`, in memory, so no worktree
  is touched (`server/cr/drift.ts`).
- Discard removes origin's side first (`gh pr close` with a comment, `git
  push origin --delete`). Then `beforeDiscard` (set from `onDiscard` in
  `server/studio-server.ts`) closes the change request's agents, watchers
  and sync and removes its transcripts, proposals and comments under
  `STUDIO_HOME`; then the worktree and the local branch go
  (`server/cr/manager.ts`).
- A commit (`server/git/commit.ts`) adds and commits the picked paths alone
  with `git commit --cleanup=whitespace`, rolling the index back
  (`write-tree`/`read-tree`) when it fails. It is authored by the signed-in
  person, `Name <id+login@users.noreply.github.com>`.
- Git takes no optional locks for the Studio's reads, so a git command in
  a terminal never meets the Studio's `index.lock`.

## Page tree and asset changes

The page tree runs the same fumadocs `loader()` as `lib/source.ts` over
`content/notes` (`server/tree/build.ts`), so it comes out as the site's
sidebar does; hidden pages come from `lib/visible-page-tree.ts`.

Tree changes go through `POST /api/tree`, asset changes through `POST
/api/assets` and a replace through `PUT /api/assets`. They share the worktree's notes
lock (`server/workspace.ts`), which commits, pushes, restores, proposals and
agent writes take too, so one runs at a time. Each
change is planned against the disk, then applied: every file it writes must
still have the mtime it was planned from, checked before anything is
written and again just before each write; otherwise the answer is `409`. A
dry run plans without the lock.

- A tree rename moves the page or folder first, so a move that fails writes
  nothing. Reorders swap the text of the `meta.yaml` entry lines
  (`server/tree/meta-edit.ts`); hide and show edit one line
  (`server/tree/visible-edit.ts`).
- An asset rename moves the asset first, then writes each note
  atomically; if the first note cannot be written, the asset moves back. A
  replace that changes the extension writes the new file, rewrites the
  notes, and removes the old one only once the notes are written; if the
  first note cannot be written, the new file is removed instead.
  References are read on the parsed note (`server/assets/refs.ts`), the
  same reading as lint's `asset-missing`; rewritten Markdown destinations
  are percent-encoded.
- Diagram sources (`server/assets/sources.ts`) are read again when a note
  or an asset changes, not when a diagram does; files over 1 MB and
  symlinks are skipped.

## Agents

The Studio is an ACP client (`server/agents/`). A chat is one ACP session
over many turns: its agent is a process the Studio starts for the first
message and keeps between turns (`connection.ts`, `conversations.ts`). The
agent is started in the change request's worktree without the Studio's own
`STUDIO_*`, `GH_*` and `GITHUB_*` variables (`profiles.ts`).

| Agent | Started with | Fenced in by |
| --- | --- | --- |
| Claude Code | `@agentclientprotocol/claude-agent-acp`, pinned in `package.json` | the `default` mode (it asks before edits and commands, whatever your `permissions.defaultMode`); bypass mode off; `git push` and `gh` denied to an author, best effort (`git -C . push` does not match: the question in the chat is the fence); edits, `NotebookEdit` and the shell denied to a reviewer; its own file tools denied on notes (`Edit(content/notes/**/*.mdx)`), so it proposes and creates notes through `propose_edit` |
| Codex | `@agentclientprotocol/codex-acp`, pinned | the `workspace-write` sandbox (worktree only, no network) for an author, `read-only` for a reviewer, set through `INITIAL_AGENT_MODE` |
| omp | `omp acp` | its own permission prompts |
| Hermes Agent | `hermes acp` | the toolsets in your `~/.hermes/config.yaml` |

- **On main** (`main-only.ts`). A chat on main may pick either role, but
  every agent runs fenced as a reviewer (its tools, ACP writes, the
  questions it asks, its MCP token), whatever it was told. It runs in
  `worktrees/_main-agents`, a detached worktree that `cr/manager.ts` checks
  out at `_main`'s commit and cleans (`git clean -dfx`) before a turn
  starts while no other turn on main runs (the chats share it), so even
  omp or Hermes, whose own tools may write without asking, leave `_main`
  and every branch as they were. A message's context is checked against
  `_main` itself. A turn on main lists no changed
  files and has nothing to keep or revert. After each message the Studio
  adds one line saying the chat is on main and how to hand work on: an
  agent there gets `create_cr { name, brief }` (`server/mcp/handoff.ts`),
  once per message, which opens a change request and starts an author chat
  there with the same agent, for the person who sent the message, its
  brief as the first message (`from` on that turn names the chat on main).
  The chat on main records a `handoff` event with the slug and the link
  (`/?cr=<slug>&chat=<id>`; `?chat=` opens a chat in the panel), also when
  the chat there could not start (then `chat` is null and the link opens
  the change request). Only the routes of a chat write on main (start,
  message, cancel, answer, delete, attachment): `server/workspace.ts`
  lists them.
- **Roles.** A reviewer only reads: whatever it asks for beyond reading
  (`read`, `search`, `fetch`, `think` tool calls), the Studio refuses
  without asking, whichever the agent. omp and Hermes cannot be held to
  reading from outside, so their own tools may still change a file they do
  not ask about; the chat lists it.
- **Files** (`fs-policy.ts`). `fs/read_text_file` reads any file of the
  worktree except hidden ones (`.git`, `.env`) and none a symlink leads out
  to; `fs/write_text_file` writes only text the Studio itself edits (notes,
  `meta.yaml`, diagrams, SVG and HTML assets), for an author, under the
  notes lock, up to 2 MB each. A write to a note that exists becomes a
  proposal, and the agent is answered that it did, so it does not read the
  note back expecting its text. A note the chat created stays its own
  draft, written directly, until anyone else changes it (a save, a revert,
  the live editor, any edit on disk). Between turns the Studio takes no
  write from the agent: nobody would follow it.
- **What a turn changed** (`watch.ts`, `worktree.ts`, `turn-changes.ts`).
  Codex, omp and Hermes write with their own tools; the Studio sees those
  edits in their tool calls and, at the end of each turn, in `git status`
  against the turn's start plus the files of any commit made during the
  turn, so a file edited by hand meanwhile is listed too. When a turn
  begins, the Studio keeps what each file that differs from `HEAD` holds;
  the turn's changes are kept in `<chat>.t<n>.changes.json` next to the
  transcript. A revert made while a later turn runs counts as a person's
  save for that turn; other pages read the list again after each decision
  (`decided` on the event stream).
- **Context** (`context.ts`, `attachment-blocks.ts`). The server checks
  every path against the worktree (no `..`, `.git` or symlinks), keeps the
  context on the turn, and adds it below the message: the note, the lines
  and the selected MDX (up to 40,000 characters), the mentions (up to 20)
  and the attachments by name (up to 5). The attachments follow as ACP
  content blocks: an image when the agent takes images, else an embedded
  resource when it takes embedded context, else a `file://` link. They are
  kept in `<STUDIO_HOME>/agents/<slug>/attachments/`; those no message sent
  are swept after an hour.
- **Tools.** Every session gets the Studio's MCP server, on a resume or a
  load too, over HTTP when the agent says it can (`mcpCapabilities.http`),
  else through the stdio bridge, with a token for the chat's agent process
  (see [MCP server](#mcp-server)).
- **Permission.** `session/request_permission` asks in the chat with the
  agent's own options less `allow_always`, which would outlive the chat;
  the server rejects when nobody answers within 5 minutes.
- **Processes** (`sessions.ts`). At most three agent processes per change
  request; one idle for 10 minutes stops; a fourth chat stops the one idle
  longest, never one answering (all three answering: `409`). Cancel sends
  `session/cancel` and stops the process 10 seconds later if the agent has
  not ended its turn. Discarding the change request or stopping the Studio
  stops them all. A stopped chat starts again with `session/resume` when
  the agent offers it, else `session/load` (its replay of the history is
  dropped: the transcript has it), else a new session.
- **Transcripts** (`transcripts.ts`). Every event goes to `GET
  /api/agents/events` (numbered per chat; on connecting it sends a snapshot
  of each chat whose agent is answering; the page's stream is under the
  [connection watch](#connection-watch)) and to
  `<STUDIO_HOME>/agents/<slug>/<chat>.jsonl`, with the summary (agent,
  model, role, status, turns, session, cost from `usage_update`, files
  written, who started it) in `<chat>.json`: next to the worktrees, never
  in the branch. A run kept from before chats reads as a one-turn chat,
  with its changes from `<id>.changes.json`. For Claude Code's "default"
  model, the summary's model is the one it stands for (`connection.ts`).
- **Live test.** `STUDIO_AGENT_LIVE=1` runs a real chat with each installed
  agent (see [checks.md](checks.md#agent-tests)); the other tests use a
  stand-in ACP agent.

## MCP server

The tools every agent gets, at `POST /api/mcp` (Streamable HTTP,
stateless; `server/mcp/http.ts`, body up to 4 MB). The same server serves
the chats the Studio starts and your own agents in a terminal (see
[setup.md](setup.md#connect-an-agent-from-a-terminal)).

| Tool | Access | What it does |
| --- | --- | --- |
| `list_crs` | read | The change requests (a person's agent only: a chat's agent works in its own) |
| `create_cr` | write | A new change request (a person's agent). A chat's agent on main gets it with a `brief`: it opens the change request and starts an author chat there, answering `{ slug, name, branch, url, conversationId }`, once per message (see [Agents](#agents)) |
| `list_notes` | read | Every note: path, title, description, tags, keywords |
| `read_note` | read | A note's text, its top-level blocks (index, line, first line) and the proposals waiting on it |
| `search_notes` | read | Notes with every word of the query in their title, description, tags or text, with up to 3 matching lines each (20 notes by default, at most 50) |
| `note_graph` | read | Links out and in, tags, keywords and graph keywords, notes that share a tag |
| `note_vocabulary` | read | Every tag, keyword and graph keyword the notes use, with how many notes use each, most used first |
| `related_notes` | read | The notes most related to one (10 by default, at most 30), ranked by shared tags and keywords, links either way and title words; each with its href from the note, why, and whether the note already links there |
| `propose_edit` | write | A proposal: the whole new text, or up to 100 find/replace edits; answers its hunks, lint issues, and `outsideSelection` when the message selected other lines. Nothing is written. A note that does not exist yet is created with `content`; the same turn's later edits to a note it created are written too (`written: true`), until someone else changes it. |
| `add_comment` | read, but a person needs write access | A comment on a note, or on one of its blocks, kept in `<STUDIO_HOME>/comments/<slug>.jsonl` |
| `list_assets` | read | The assets under `public/notes` and the notes that use them |
| `diagram_list`, `diagram_read`, `diagram_validate`, `diagram_render_png` | read | The diagrams; one as JSON with its checks; the checks alone; a PNG the agent can look at |
| `diagram_create` | write | A new diagram file (refused when one exists) |
| `diagram_add_node`, `diagram_connect`, `diagram_move`, `diagram_set_note` | write | Add a node, connect two, move one (not in a sequence or a lifecycle, which lay themselves out), set a node's note |
| `diagram_update` | write | A node's, an edge's or a group's fields (an edge's label pin and end sides included), a sequence's segments and activations, or a lifecycle's `mainPath` |
| `diagram_reorder` | write | A sequence's participant or message to a new place (a lifecycle's order is its `mainPath`) |
| `diagram_remove_edge`, `diagram_remove_node` | write | Remove an edge, or a node with its edges |
| `diagram_layout` | write | Lay out what has no position, or with `all` the whole diagram again (hand-placed positions, route pins and canvas size dropped); a sequence or a lifecycle lays itself out |

- **Change request.** Every note and diagram tool takes `cr`, the change
  request's slug; a chat's token holds it to its own. `main` and `_main`
  are refused, as is a change request that does not exist. Paths go
  through the path policy (`server/files/studio-files.ts`).
- **Access.** A `write` tool is refused to a reviewer chat and to a reader,
  and `tools/list` leaves out the tools a caller may not use; the others
  are open to anyone who may read. A reviewer comments instead of
  proposing.
- **Who.** From the bearer token: a chat's (`server/mcp/grants.ts`, made
  when its agent process starts, dropped when it stops, refused between
  turns; the grant's `runId` is the chat's id), or with sign-in on, a
  person's agent token from `POST /api/mcp/tokens`, acting with their role
  until they clear it or their session ends. With sign-in off a request
  without a token acts for the one person of this machine.
- **Diagram writes** (`server/mcp/diagram-tools.ts`) go through `ctx.files`
  with the mtime they read, so a save made meanwhile is refused, not
  overwritten. Each write lays out what has no position
  (`lib/diagram/auto-layout.ts`) and answers with the checks; elkjs and
  resvg load on first use, from the repository root's packages. The edits
  are shared with the site's CLI in `lib/diagram/ops.ts`.
- **More tools.** A tool is a `StudioTool` (`server/mcp/tool.ts`): a name,
  a zod input, `read` or `write`, and `run(args, ctx)` with the change
  request's worktree and its files. `writing-tools.ts`, `note-tools.ts` and
  `diagram-tools.ts` hold the tools; `studio-server.ts` mounts them
  together. `list_crs` and `create_cr` are the exception: they take no
  change request, so they are `crTools` in `server/mcp/http.ts`, left out
  of a chat's `tools/list` and refused to it, but for `create_cr` with a
  brief to a chat on main. A chat on main reads main with the read tools;
  every write tool tells it to call `create_cr`.

## Proposals

Proposals live in `server/proposals/`, stored in
`<STUDIO_HOME>/proposals/<slug>/`, outside the branch; a discarded change
request's go with it.

- **Hunks** (`hunks.ts`). The note is split into blocks as the editor
  splits them (the frontmatter first), the proposed text too, and the two
  are aligned with `src/diff/align.ts`, shared with the diff view. Each
  stretch between two unchanged blocks that differs is a hunk: what it
  removes, spacing included, and what it adds.
- **Placement.** A hunk applies where its own blocks still are, word for
  word; its neighbours only break a tie. Once its own blocks changed it is
  stale. The page runs the same placement on the text in the editor
  (`src/suggestions/`), so typing never waits for a save.
- **Accept** writes under the notes lock, from the mtime it read.

## The site's look

The editor imports the site's look rather than copying it, so a change on
the site shows here with no Studio edit:

- colours and fonts: `styles/notes-theme.css` (`.notes-theme`), mapped
  onto the editor's `--fde-*` tokens in `src/notes-theme.css`;
- prose, callouts, title and description: `styles/notes-prose.css`
  (`.notes-prose`, `.notes-title`, `.notes-description`). The editor's
  stylesheet sits in a cascade layer so these rules win over it;
  `src/notes-prose.css` keeps only what the editor needs on top, where its
  markup differs from the page's. The site's prose is for the note's
  content: what the editor draws and does not let you edit (a diagram
  preview's labels, a control) keeps the editor's look;
- components: the callout's icons and variables from
  `components/notes-callout.tsx`, Keyword and Tag from the class names
  `components/graph-objects.tsx` exports (Tailwind scans that file), the
  accordion's icons and palette from `lib/notes-accordion.ts`, and the
  directive names, callout types and accordion kinds from
  `lib/notes-syntax.ts`;
- light and dark follow the system (`.dark` on `<html>`, as next-themes
  sets it on the site);
- Mermaid previews take the site's diagram palette: `NoteEditor` marks the
  author's fills on each one as the site does (`lib/pele-author-fill.ts`),
  so dark mode gets the right node ink, subgraph tint and title halos, and
  the code block frame sets `--notes-diagram-bg`, the plate behind each
  edge label;
- `<Diagram>` cards and the diagram editor: `styles/diagram.css`, imported
  by `src/plugins/diagram/Diagram.tsx` (`src/diagrams/diagram-page.css`
  adds only the editor's chrome).

What the editor cannot import stays a copy in its plugin: the accordion
card, the code block frame, `SvgDiagram`, `YouTube`, `HtmlEmbed` and the
`<Diagram>` props. The site marks the parts each copy mirrors with
`// studio-copy start: …` and `// studio-copy end`;
`tests/src/site-copies.test.ts` pins their hash and fails when one of them
changes, not on other edits to the file.

The editor's block drag handle is drawn as a grip
(`src/editor/drag-handle.css`, found by its `aria-label`;
`tests/src/editor/drag-handle.test.ts` fails if a new editor version
changes it).

## Plugins

What the editor understands comes from plugins in `src/plugins/<name>/`.
`src/plugins/index.ts` finds every `index.ts` or `index.tsx` there
(`import.meta.glob`), and the registry (`src/plugins/registry.ts`) checks
and merges them, so adding a plugin needs no change anywhere else.

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
- `syntax` turns on parse-level dialects such as `directives`; a dialect is
  on when any plugin turns it on.
- `decorate` draws over what the editor keeps as source (inline JSX tags,
  text directives, verbatim blocks) with ProseMirror decorations. It
  changes how the document looks, never the document.
  `src/editor/decorations.ts` puts every plugin's decorator on the live
  editor (`MdxEditor.Root` takes no extra extensions, so it is registered
  on the TipTap editor itself). Cards share `src/plugins/cards.css`;
  `.studio-hidden` hides the source a card covers.
- A plugin must export a default; two plugins may not share an `id` or
  define the same component.
- `tests/src/plugins/round-trip.test.ts` parses and writes back every note
  with all plugins loaded, one test per note, and fails if a byte changes.
  Put sample MDX for a new component in `src/plugins/<name>/fixtures/*.mdx`
  to add it to that test.

The plugins:

- `callout`: `<Callout>` and `:::type[title]` drawn with the classes, icons
  and variables of `components/notes-callout.tsx`, with the site's types
  and an icon menu to change them. The editor only parses the admonition
  names in core's `ADMONITION_TYPES`, so the plugin adds the site's own
  (`example`, `caution`, `important`, `error`, from `lib/notes-syntax.ts`)
  to that object at load; `tests/src/plugins/callout.test.ts` fails if a
  new editor version stops reading it. A callout whose title has
  formatting, or that holds an accordion group, stays source (the editor's
  rule).
- `graph-objects`: `<Keyword>`, `<Tag>`, `:keyword[…]` and `:tag[…]` with
  the classes of `components/graph-objects.tsx`, `<GraphMeta/>` and
  `:graph-meta{…}` as a small marker, all as decorations: with the caret
  inside (or the atom selected) the source shows again. `<SectionTitle>` is
  a component, drawn as the heading its `as` names.
- `site-directives`: `::::accordions` groups as the site's accordion cards
  and `::youtube` as a card. On an accordion card the icon picks the item's
  `kind` (from `ACCORDION_KINDS`), the title is edited in place on the
  head, and the body opens as MDX source. Each is written back as typing
  pauses and rewrites only its own line or lines: a kind or title keeps its
  quotes and its place, a title written as the `[label]` stays there, and
  an empty title is not written. Titles show the text the site shows
  (character references and label escapes decoded) and are written so they
  read back the same. The MDX button shows the block's
  source.
- `site-inserts`: the `/` menu items for graph markers, directive blocks
  and a Mermaid diagram. The menu lists components, so each is a spec named
  `studio-insert-…` whose `insert` returns the site's syntax (or, for
  Mermaid, the editor's code block) instead of a node of its own; no note
  has such a tag, and `tests/src/plugins/site-inserts.test.ts` checks that
  none parses. The menu matches the query against labels only, hence the
  label "Mermaid diagram".
- `diagram`: `<Diagram>`, drawn with the site's renderer and the count of
  its checks' findings, its caption edited in place and `src` and `title`
  in the props panel.
- `youtube`: `<YouTube>` as the same card as `::youtube`, its title edited
  in place and its url or `videoId` in the props panel.
- `fumadocs-ui`: Cards, Steps, Tabs and Accordions.
- `html-embed` and `svg-diagram`: cards. `SvgDiagram` shows its inline
  `svg` (as an image, so no script runs) or else a file under
  `public/notes` through the file API, and reads its props like the site
  (`lib/mdx-props.ts`); a bare JSX boolean (`plate`) reaches the editor
  without a value, so write `plate="true"` to see it. `HtmlEmbed` shows no
  live page, since the file API serves HTML assets sandboxed without
  scripts.

## Write actions

Every button or dialog that writes to the server follows one pattern
(`src/actions/`), so nothing goes twice and nothing looks stuck:

- **One at a time.** `useBusy()` runs a component's write: a second click,
  Enter pressed again or Escape while it is out does nothing. Its `run`
  holds a ref, so even two clicks before React renders send one request.
  Actions that touch the same thing share one `useBusy` (the bar and the
  cards of a note's suggestions, Keep and Revert of a file).
- **It shows.** `PendingButton` is disabled at once, `aria-busy`, and after
  150 ms shows a spinner and what it is doing; a request quicker than that
  never flashes. An icon button's icon becomes the spinner.
- **Dialogs wait.** `Dialog` takes `busy`: while the request is out it
  neither closes (Escape, the backdrop, Cancel) nor sends again. It stays
  open when the request fails.
- **Errors are toasts.** A failed action says why in the toast stack at the
  top right (`toast.error`, `role="alert"`; `toast.warning`,
  `role="status"`; `ToastStack`): gone after 8 seconds or on Dismiss, one
  copy of a message while it is shown (a repeat restarts its timer). The
  stack sits on `<body>`, over a dialog, and a dialog leaves it out of what
  it makes inert. What fails to load stays where the content would be.
- **Done already is not an error.** A repeat the server refuses as done
  (`409` on an answer or a cancel another click or page sent first) shows
  nothing.
- **The chat shows a message at once.** The composer empties as it sends;
  the message shows in the thread, marked Sending, until the stream brings
  it, and comes back to the box if it did not go.
