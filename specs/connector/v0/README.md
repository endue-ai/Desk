# Desk connector v0

A connector brings an app's data into Desk as items (`specs/item/v0`) and its actions as commands; it
has no screen of its own (ADR 0032). One contract, two bindings: `wasm`, a component the plugin's
`entry` names (local and light, no VM), and `mcp`, an MCP server inside the VM (ADR 0002). A plugin of
kind `connector` declares it under `connector` in `plugin.json`: `ConnectorManifest` in
`connector.schema.json`. v0 may break on any minor release (ADR 0004).

| Field | Meaning |
| --- | --- |
| `binding` | `wasm` or `mcp` |
| `auth` | `kind` `none`, `token` (pasted; `title` says what) or `oauth` (`authorizationUrl`, `tokenUrl`, `scopes`; declared only: no v0 method starts a flow) |
| `resources` | One entry per item kind it brings in: `kind`, `actions` (command ids), `live` (it also answers queries beyond the index) |
| `sync` | `mode` `pull`, `push` or `both`; `intervalSeconds` between pulls, 60 to 86400, 900 when absent |
| `instanceSettings` | What the person fills in per instance, by name: `kind` (`string`, `integer`, `boolean`), `title`, `description`, `default`, `required`, `secret` |

- Actions are commands: every id in `resources[].actions` is one the plugin declares in
  `contributes.commands`, and views, the palette, Eris and agents run it with `cmd.invoke`. There is no
  `data:write`. `desk_bridge::manifest_problems` checks the rule; the contract tests judge vectors with it.
- Secrets stay with the core: a `secret` setting is a string kept in the OS keychain, never listed back
  and never handed to the connector's code, and so are tokens.

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
