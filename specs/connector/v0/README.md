# Desk connector v0

A connector brings an app's data into Desk as items (`specs/item/v0`) and its actions as commands; it
has no screen of its own (ADR 0032). One contract, three bindings: `wasm`, a component the plugin's
`entry` names (local and light, no VM), `mcp`, an MCP server inside the VM (ADR 0002), and `http`,
requests and a mapping the core runs from the manifest, with no code and no `entry` (ADR 0106). A plugin of
kind `connector` declares it under `connector` in `plugin.json`: `ConnectorManifest` in
`connector.schema.json`. v0 may break on any minor release (ADR 0004).

| Field | Meaning |
| --- | --- |
| `binding` | `wasm`, `mcp` or `http` (then `http` says what the core runs) |
| `auth` | `kind` `none`, `token` (pasted; `title` says what) or `oauth` (`authorizationUrl`, `tokenUrl`, `scopes`; declared only: no v0 method starts a flow) |
| `resources` | One entry per item kind it brings in: `kind`, `actions` (command ids), `live` (it also answers queries beyond the index) |
| `sync` | `mode` `pull`, `push` or `both`; `intervalSeconds` between pulls, 60 to 86400, 900 when absent |
| `instanceSettings` | What the person fills in per instance, by name: `kind` (`string`, `integer`, `boolean`), `title`, `description`, `default`, `required`, `secret` |

- Actions are commands: every id in `resources[].actions` is one the plugin declares in
  `contributes.commands`, and views, the palette, Eris and agents run it with `cmd.invoke`. There is no
  `data:write`. `desk_bridge::manifest_problems` checks the rule; the contract tests judge vectors with it.
- Secrets stay with the core and never come back out (ADR 0036): a `secret` setting is a string that is
  never listed back and never handed to the connector's code, and so are tokens.

## HTTP binding

`http` (`HttpBinding`) is a connector as data. The core runs it; nothing of the plugin's runs.

| Field | Meaning |
| --- | --- |
| `baseUrl` | https, or http on 127.0.0.1 / localhost. Every request needs the plugin's `net:fetch` grant for its host |
| `headers` | Sent with every request; never `Authorization`, `Cookie` or `Host` |
| `auth` | `setting`, a secret instance setting the core reads; sent as `header` (`Authorization`) with `prefix` (`Bearer `) |
| `requests` | GET `path` with `query`; the records at the pointer `items`; `pagination` `link` (RFC 8288 `rel="next"`) or `body` (a URL at `pointer`), on the base URL's origin only, `maxPages` (10) at most; the `map` that makes them items |
| `maps` | By name: `kind` and `fields`, each item field from a JSON pointer into the record (`""` is all of it), `{ pointer, after?, values?, default? }` or `{ const }` |

- Each sync reads every page of every request again, writes what is new or changed and removes what
  left; the same id from two requests is one item. A record whose item does not fit `specs/item/v0` is
  skipped. A 401 or 403 is `error` with `reauth`; a 429, or a 403 with `x-ratelimit-remaining: 0`, waits
  for the next sync. Messages name the status, never the token.
- `desk_bridge::manifest_problems` checks the names: `auth.setting` is a declared secret setting,
  `auth.kind` is `token`, each request's `map` is in `maps`, each map's `kind` is in `resources`, and
  each map's `fields` give `id` and `title`.

Host-facing: `ConnectorInstance` (an id unique within its connector, which items carry in `source`; its
settings but the secret ones; status), `ConnectorStatus` (`connected`, `syncing`, `stale`, `error` with
`message` and `reauth`, or `paused`; `lastSyncAt`) and `ConnectorSyncResult` (`changes`, the next
`cursor`, `done`).

## MCP profile

Any MCP server is a weak connector (tools only, for the brain); one that follows this profile is strong.

- Items are resources of MIME type `application/vnd.endue.item+json`, each one v0 `Item`. Their URIs are
  the server's own; the host sets `source`, whatever the server sent.
- `resources/read` of `desk://sync?cursor=<cursor>` (no cursor: from the start) returns one
  `ConnectorSyncResult` as `application/vnd.endue.sync+json`.
- With `sync.mode` `push` or `both`, a `resources/subscribe` to `desk://sync` makes the server send
  `notifications/resources/updated` when something changed; the host reads again.
- The action `<plugin id>.<name>` is the server's tool `<name>`, called with the command's args.

`vectors/` holds valid and invalid connector blocks, instances, statuses and sync results.
