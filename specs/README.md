# specs

The line between open and closed. Language-neutral contracts and the single source of truth for every
type that crosses a boundary: the Desk bridge, the brain API and plugin manifests.

| Folder | Contract |
| --- | --- |
| `bridge/v0/` | Desk bridge: JSON Schema plus one page per method (fs, proc, net, audio, ui, perm) |
| `brain/v0/` | Brain API: `openapi.yaml` (sessions, turns, streaming, leases) |
| `plugin/v0/` | `plugin.json` manifest schema and the permission vocabulary |
| `wit/` | Wasm host interface for logic plugins (`desk:host`) |

Spec first: change a file here, run `just codegen`, then implement. Generated files are committed and
start with a GENERATED header. Each spec keeps valid and invalid examples in `vectors/` that both the Rust
and TypeScript sides must agree on.

Status: empty until specs v0.
