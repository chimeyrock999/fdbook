# Checks

Read this before pushing a Studio change: what to run, how the tests are
set up, and which tests are known to flake.

## What to run

There is no CI in this repository: nothing runs these checks on a push or a
pull request, and Cloudflare Pages builds only the site. Run them by hand
before pushing.

From the repo root:

```sh
npm --prefix tools/notes-studio test               # vitest run
npm --prefix tools/notes-studio run lint           # strict typescript-eslint + React hooks
npm --prefix tools/notes-studio run types:check    # tsc --noEmit
npm run studio:lint                                # every note through the Studio's lint
```

Or in `tools/notes-studio`:

```sh
npx tsc --noEmit
npx eslint src server tests
npx vitest run --maxWorkers=2
```

`--maxWorkers=2` keeps the suite from starving the slow tests on a busy
machine (see [Known flakes](#known-flakes)). A change that touches the
site's `lib/`, `components/` or `styles/` also needs the root checks:
`npm test` (the root `tests/`), `npm run lint` and `npm run types:check`.

## How the tests are set up

- `vitest.config.ts` sets no environment, pool or timeout of its own:
  tests run in node with vitest's 5-second default.
- `tests/global-setup.ts` stops the whole run, with the reinstall command,
  when the installed packages differ from the lockfiles (as the server does
  at start; see [setup.md](setup.md#after-a-pull)).
- Tests that render the editor run in jsdom (`// @vitest-environment
  jsdom` at the top of the file). `tests/setup/jsdom.ts` runs before every
  test file: it gives the window the `matchMedia` jsdom lacks, which the
  live editor asks once it replaces the first paint
  (`tests/jsdom-setup.test.ts` checks it), and clears the toasts after
  every test. `stubLayout` in `tests/support/visual-editor.tsx` adds the
  layout stubs the editor's menus need.
- `tests/support/` holds the fixtures: a throwaway worktree and a Studio on a free port
  (`studio.ts`), git repositories for change requests (`git-repo.ts`, `git.ts`), raw HTTP, event
  stream and sync helpers (`http.ts`, `events.ts`, `sync.ts`), sign-in
  (`auth.ts`), the real notes (`notes.ts`) and a stand-in ACP agent
  (`fake-agent.mjs`).

## Tests over every note

A test over every real note grows with `content/notes` while the default
timeout stays at 5 seconds, so a busy machine times it out. Where the check
is per note, write it as one `it.each` test per note (`realNotes()` in
`tests/support/notes.ts`), with a separate test for the count, as
`tests/server/lint/notes.test.ts` does. A test that renames, replaces or
lints across a copy of the whole corpus takes `CORPUS_TIMEOUT_MS` (30
seconds) from `tests/support/timeouts.ts`.

Tests that pin the site's code:

- `tests/src/plugins/round-trip.test.ts` parses and writes back every note,
  and each plugin's `fixtures/*.mdx`, with all plugins loaded, and fails if
  a byte changes.
- `tests/src/site-copies.test.ts` pins the hash of each part of a site file
  marked `// studio-copy start: …` (see
  [architecture.md](architecture.md#the-sites-look)).
- `tests/server/lint/notes.test.ts` keeps every note at zero lint issues.

## Agent tests

The agent tests use a stand-in ACP agent (`tests/support/fake-agent.mjs`).

```sh
STUDIO_AGENT_LIVE=1 npx vitest run tests/server/agents/live.test.ts
```

drives a two-turn chat with each installed agent as a reviewer, restarting
in between to take the session up again. It calls the chats' own module
(`createAgentConversations`) rather than the HTTP server, signs in with
your logins and costs two model calls per agent, so it is skipped unless
`STUDIO_AGENT_LIVE` is exactly `1`.

## Known flakes

- The `DiagramPage` JSON view tests can time out under full-suite load
  (#149). Re-run them alone, or the suite with `--maxWorkers=2`, before
  blaming a change.
