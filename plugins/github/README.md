# plugins/github

`desk.github`, your GitHub work as `task` items: a `connector` plugin with no code. Its `http` block
(`specs/connector/v0`, ADR 0106) is what the core runs every 15 minutes: three searches on
`api.github.com`, each page followed through the `Link` header, every record mapped into an item.

| Search (`/search/issues`) | Brings in |
| --- | --- |
| `is:open assignee:@me` | issues and pull requests assigned to you |
| `is:open is:pr review-requested:@me` | pull requests waiting for your review |
| `is:open is:pr author:@me` | your own open pull requests |

One item per issue or pull request (the same one from two searches is one item): id `node_id`, title,
`open`, project `owner/repo`, due from the milestone, the page on github.com as its deep link, the
search record whole in `raw` (`endue.projects` reads it, ADR 0085). Work that is closed or no longer
yours leaves at the next sync. Nothing is written back to GitHub.

The token is the instance's secret setting `token`: entered in Settings, Connections ("Connect
GitHub", `desk.github.connect`), kept by the core in the secrets file, sent only to `api.github.com`
as `Authorization: Bearer`, never listed back and never handed to a plugin. A fine-grained token
with read access to Issues and Pull requests is enough. A 401 or 403 puts the instance in `error`
with "connect again".

| Permission | Why |
| --- | --- |
| `net:fetch` (`api.github.com`) | The core's requests on its behalf |

Today shows its open work in a GitHub section; Projects shows it in every view.

```bash
pnpm exec vitest run plugins/github
cargo test -p desk-core --test connectors_http
cargo run -p desk-cli -- plugin validate plugins/github
```
