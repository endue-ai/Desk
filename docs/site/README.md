# docs/site

Documentation site configuration (Starlight). Markdown in `docs/` is the source of truth; the site is a
build output. The site configuration itself is not here yet.

## API reference

The API reference is rendered from `specs/` when the site builds and is never committed. Specs change in
open pull requests all the time, and a committed copy would drift from every one of them; a rendered one
cannot. The site build runs, before `astro build`:

```bash
just docs-api docs/site/src/content/docs/reference/api
```

`scripts/spec-docs.mjs` writes five Markdown pages with Starlight front matter into that folder:

| Page | From | Holds |
| --- | --- | --- |
| `index.md` | | What each page holds |
| `bridge.md` | `specs/bridge/v0` | Every method with its params, result, errors and permission; every event; their types |
| `permissions.md` | `specs/plugin/v0` | The permission vocabulary: scope fields and what each permission covers |
| `manifest.md` | `specs/plugin/v0/plugin.schema.json` | Every `plugin.json` field |
| `brain.md` | `specs/brain/v0/openapi.yaml` | Every endpoint with its parameters, body and responses; the schemas |

The command exits 1 when a method, event, permission, manifest field or endpoint in the specs is missing
from the pages, so a broken render fails the site build instead of publishing a gap. `.gitignore` keeps
the folder out of git. To read the reference locally, render it anywhere: `just docs-api /tmp/desk-api`.
The tests, `scripts/spec-docs.test.mjs`, run with `just test-unit`.
