# specs

The line between open and closed. Language-neutral contracts and the single source of truth for every
type that crosses a boundary: the Desk bridge, the brain API, plugin manifests, `init.yaml`, and the
items, views and connectors of the integration layer.

| Folder | Contract |
| --- | --- |
| `bridge/v0/` | Desk bridge: JSON Schema plus one page per method (fs, proc, net, audio, ui, perm, store, init, plugins, brain) |
| `brain/v0/` | Brain API: `openapi.yaml` (sessions, turns, streaming, leases) |
| `plugin/v0/` | `plugin.json` manifest schema, the permission vocabulary, and what plugins contribute to the desk's policies (`contributes`, ADR 0017) |
| `item/v0/` | Items, the one shape of connected data: the envelope, eight kinds plus `record`, queries, pages and changes (ADR 0032) |
| `view/v0/` | Views, surfaces written as data: requires, params, a layout of containers and components, actions as commands |
| `connector/v0/` | What a connector plugin declares, its status and sync results, and the MCP profile of a Desk-aware server |
| `init/v0/` | `init.yaml`, a person's setup: schema, the template Desk writes, and the sync rules |
| `wit/` | Wasm interfaces: the host interface logic plugins import (`desk:host`) and the world Wasm connectors build to (`desk:connector`) |

Spec first: change a file here, run `just codegen`, then implement. Generated files are committed and
start with a GENERATED header. Each spec keeps valid and invalid examples in `vectors/` that both the Rust
and TypeScript sides must agree on.

Status: v0. Any minor release may break v0 (ADR 0004). `just check` lints the specs and
`just codegen` regenerates `crates/desk-bridge/src/generated.rs`, `crates/desk-brain/src/generated.rs`,
`packages/bridge/src/generated.ts` and `packages/bridge/src/brain.generated.ts`.
