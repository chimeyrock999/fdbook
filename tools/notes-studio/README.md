# Notes Studio

A local editor for the notes in `content/notes`. It edits notes in Visual
(the note as the site renders it) or Source (the MDX), keeps the page tree,
assets and diagrams in step with the notes that use them, lints each note
against what the site gets wrong, and takes every edit from a change
request (a `cr/<slug>` branch with its own worktree) through commit,
Cloudflare preview and pull request. Coding agents (Claude Code, Codex,
omp, Hermes Agent) can work in a change request over ACP, with the
Studio's MCP tools, and their edits to existing notes come back as
suggestions to accept or reject.

The Studio is not part of the site build: `tools/` is outside the site's
TypeScript, ESLint and Tailwind sources.

## Run

From the repo root, after the root `npm install`:

```sh
npm run studio:install   # once, and after a pull that changed this package
npm run studio           # http://127.0.0.1:4310
```

It needs Node 22.18 or newer, git with an `origin` that has `main`, and `gh`
for pull requests. After a pull, reinstall and restart: the server keeps
the code it started with, and refuses to start when the installed packages
differ from the lockfiles. Serving on another address, sign-in, agents and
the other settings are in [docs/setup.md](docs/setup.md).

## Docs

| File | Read it to |
| --- | --- |
| [docs/setup.md](docs/setup.md) | run the Studio; set `STUDIO_HOST`, `STUDIO_PORT` and the other variables; set up GitHub sign-in and roles; install the agents; connect an agent from a terminal to the MCP server |
| [docs/using.md](docs/using.md) | use it: change requests, the editor and frontmatter, the sidebar and page tree, graph markers, images and assets, diagrams, changes, diff, preview, publish, history, agents and their proposals |
| [docs/architecture.md](docs/architecture.md) | change it: the layout of `server/` and `src/`, the request checks, the HTTP API, saving and the notes sync, change requests on git, agents over ACP, the MCP server and its tools, the editor plugins, write actions |
| [docs/lint.md](docs/lint.md) | know each lint rule, what it reports and why, and add one |
| [docs/checks.md](docs/checks.md) | test a change: the commands, how the tests are set up, the live agent test, known flakes |

## Where things are

```text
tools/notes-studio/
  server/       one Node process: API, notes sync, Vite, MCP server
    index.ts    entry point (checks the dependencies first)
    security/   Host/Origin guard, path policy, roles
    cr/ git/    change requests, worktrees, commits, history
    agents/     chats with agents over ACP
    mcp/        the MCP server and its tools
    lint/       the lint rules and their CLI
  src/          the React UI (editor, sidebar, views, agent panel)
    plugins/    what the editor understands of the site's MDX
  tests/        laid out like server/ and src/; fixtures in tests/support/
  docs/         these docs
```

Related docs elsewhere in the repository:

- `diagrams/README.md`: the diagram file format the diagram editor and the
  `diagram_*` tools edit.
- `skills/chimeyrock-diagram/`: how an agent draws and edits diagrams with
  those tools.

## Checks

```sh
npm --prefix tools/notes-studio test
npm --prefix tools/notes-studio run lint
npm --prefix tools/notes-studio run types:check
npm run studio:lint
```

There is no CI; run these before pushing. Details and known flakes are in
[docs/checks.md](docs/checks.md).
