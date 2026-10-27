# Desk plugin v0

`plugin.schema.json` is the `plugin.json` manifest every plugin folder carries, built-in and community
plugins alike. `permission.schema.json` is the permission vocabulary: plugin manifests declare these
permissions, and every bridge call carries the one that covers it.

## Manifest

| Field | Meaning |
| --- | --- |
| `id` | Reverse-domain id with a dot, lowercase: `endue.eris`, `example.hello-ui` |
| `version` | Semantic version |
| `kind` | `ui` (sandboxed iframe), `logic` (Wasm), `tool` (MCP inside the VM) |
| `entry` | Entry file relative to the plugin folder, never outside it |
| `permissions` | Everything the plugin may ask for; each is granted by the person at first use |
| `surfaces` | Surfaces a UI plugin can open, with a placement; other kinds declare none |

## Permission vocabulary

| Permission | Scope | Covers |
| --- | --- | --- |
| `fs:read` | `paths` | `fs.read`, `fs.list`, `fs.watch` |
| `fs:write` | `paths` | `fs.write` |
| `proc:spawn` | `commands`, `pty` | `proc.spawn`, `proc.write`, `proc.resize`, `proc.kill` |
| `net:fetch` | `hosts` | `net.fetch` |
| `audio:capture` | `wakeWord` | `audio.capture.start`, `audio.capture.stop`, `audio.wake` events |
| `ui:surface` | none | `ui.surface.open`, `ui.surface.close` |
| `ui:notify` | none | `ui.notify` |

Paths are absolute or rooted at `~`, `${plugin}`, `${workspace}` or `${home}`, with `*` within a segment
and `**` across segments. Hosts are names with an optional port, or `*.domain` for subdomains. Commands
are program names or absolute paths, without arguments.

`vectors/` holds valid and invalid manifests and permissions for the contract tests.
