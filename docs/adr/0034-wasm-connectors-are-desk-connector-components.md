---
status: proposed
date: 2026-10-31
decision-makers: Team endue
---

# Wasm connectors are components of the desk:connector world, run by the plugin host

## Context and Problem Statement

ADR 0032 gave connectors one contract with two bindings; the MCP one runs in the VM (ADR 0002),
and the Wasm one needed its world. A Wasm connector is light and local (a folder, the OS calendar):
it reaches the machine only through `desk:host` grants, like a logic plugin (ADR 0019), and the host
syncs it on a schedule and hands its items to the index. What does the WIT look like, who names an
item's source, and where does the host keep instances and cursors? Each choice is in every connector
built against it.

## Decision Drivers

* `specs/wit` stays one folder that both `bindgen!` macros (host and guest) read as `path`
* A connector writes only under its own source; nothing it sends can name another
* The item model lives in JSON Schema (`specs/item/v0`); the WIT must not become a second one
* A trap, a loop or a leak in one connector never reaches the desk, the index or another connector
* Folders and files are reached through grants the person sees, never through ambient access

## Considered Options

* World `connector` in a nested package `desk:connector@0.0.0` in `specs/wit/desk-connector.wit`, with world-function exports and JSON fields as text
* The same exports as an exported interface (`export connector;`)
* World `desk:host/connector`, next to `plugin` in `desk:host`
* Items crossing as whole JSON text (`sync` returns a string)
* WASI preopens for folder connectors instead of `fs.read` and `fs.list`

## Decision Outcome

Chosen option: the nested `desk:connector` package with world functions, because it keeps one folder
and one main package, keeps the connector's exports out of the bridge vocabulary, and types the
envelope while leaving each kind's fields to the JSON Schema.

* `desk:connector/types` mirrors `specs/item/v0` without `source`: `item` has the envelope typed
  (`id`, `kind`, `title`, `updated-at`, optional `created-at`, `deep-link`, `body`) and the kind's own
  fields (`details`) and `raw` as JSON text; `sync-result` is changes, a cursor and `done`.
* The world imports `fs`, `net`, `perm`, `store` and `log` from `desk:host` (no `ui`, `cmd`, `events`
  or `settings`) and exports `sync`, `query`, `act` and `status` as world functions: the host calls
  them, so they are not bridge methods (the bridge WIT test checks interface functions only).
* The host stamps `{ connector, instance }` on every item and checks it against the generated `Item`;
  a round with one item that does not fit reaches neither the sink nor the cursor.
* Instances (`desk.connector/instances`) and cursors (`desk.connector/cursor/<instance>`) live in the
  connector's own store; guests cannot read or write `desk.` keys. Secret settings are never stored
  there nor handed to the guest.
* One Wasmtime store per connector, shared by its instances (the instance is an argument), under the
  logic plugins' limits. A trap or a limit puts every instance of it in `error` until a reload; an
  error the guest returns marks one instance.

### Consequences

* Good, because one `specs/wit` folder serves the plugin world, the connector world, the host's
  `bindgen!` (`with` maps `desk:host` to the plugin world's modules, so one `State` serves both) and
  `wit-bindgen` guests (`generate_all`).
* Good, because no connector can write under another's source, and the index never sees an item
  the schema refuses.
* Good, because a crashed connector costs only its own instances; the index and views keep what it
  sent (shown `stale` or `error`).
* Bad, because JSON as text means the host parses and checks it on every round, and guests write
  `details` by hand without types for each kind.
* Bad, because one store per connector lets one instance's trap stop its siblings until a reload.
* Bad, because the world's four exports are all required in v0: a connector without live queries or
  actions still exports `query` and `act` that answer `unsupported`.
* Bad, because a folder connector polls (no `fs.watch` in `desk:host`), and its cursor (every file's
  modification time) grows with the folder, against the store's 64 KiB values.

Rejected: an exported interface would make `sync` and the others look like `<interface>.<function>`
bridge methods to the bridge WIT test and to anyone reading `specs/wit`; `desk:host/connector` would
put a second world in the package that both `bindgen!` macros resolve by bare name, and mix the
bridge subset with the host's own calls; whole-JSON items would leave the envelope untyped in every
guest language; WASI preopens would give a connector a folder outside the grants the person sees
(`fs:read`, ADR 0019's empty WASI), with no `perm` prompt and no revoke.

## More Information

Issue #96. Code: `crates/desk-plugin-host` (`ConnectorHost`, `IndexSink`, `Clock`),
`specs/wit/desk-connector.wit`, `examples/plugin-hello-connector`, the `connector` template of
`packages/create-plugin`. Requirements CN-01, CN-03, CN-04, CN-09, CN-10 and CN-11 of the integration
requirements draft. ADR 0002 (MCP in the VM), ADR 0019 (logic plugins on Wasmtime), ADR 0032 (one
connector contract). desk-core wires the host to the index and to `connector.*` in #98.
