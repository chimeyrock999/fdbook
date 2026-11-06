# FdBook

An editor for the MDX pages of a [fumadocs](https://fumadocs.dev) site: a
Visual and a Source mode, the page tree, files and diagrams kept in step
with the pages, lint, change requests from branch to pull request, review,
and coding agents that propose edits over MCP.

```sh
npm install
npm run docs                    # the Studio on FdBook's own docs
npm run studio -- ../my-site    # the Studio on another fumadocs site
```

The docs are in [`docs/`](docs/content/docs/index.mdx), a FdBook project
that the tests also run on.

| Package | What it is |
| --- | --- |
| `packages/server` | The Studio server: API, notes sync, Vite, change requests, agents, MCP |
| `packages/ui` | The Studio UI |
| `packages/shared` | What the server and the UI both read |
| `packages/diagram` | Diagram files: schema, checks, layout, rendering |
| `packages/mdx` | The MDX a site and the Studio share |
| `packages/testing` | Test helpers |

Before pushing: `npm test`, `npm run lint`, `npm run types:check`,
`npm run docs:lint`.
