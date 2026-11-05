---
status: accepted
date: 2026-11-05
decision-makers: Team endue
---

# Desk attaches MCP servers as callers of their own

## Context and Problem Statement

Desk is an MCP server for other apps (ADR 0086), but not a client: the tools people already run as MCP
servers (GitHub, a database, a notes app) do not reach Eris or the desk's agents. The roadmap's control
center (milestone M4, killer feature 10, ADR 0093) needs them on the same footing as plugin commands.
Where does a person list servers, under which caller and grant does a server run, how do its tools
become something an agent may call, and what keeps a server from seeing more than it was given?

## Decision Drivers

* One registry and one gate: tools reach agents as commands (ADR 0088), under the permission engine,
  the allowlist, prompts and approvals (ADR 0072, 0078), never beside them
* Nothing runs without the person: init.yaml may sync from another desk (ADR 0016), so a line in it
  must not be enough to start a program here
* A server sees the tokens it was given and no others; init.yaml never holds a secret
* A server's own claims about its tools are hints: the safe reading wins when a claim is missing
* In process now; the VM of ADR 0002 later, without changing what people write or see

## Considered Options

* A new crate, `desk-mcp-client`, that runs each init.yaml server as the caller `mcp:<name>` through
  the bridge, after `perm.request` of `proc:spawn`, and registers its tools as `mcp.<name>.*` commands
* Servers as plugins: a manifest and a plugin folder per server
* The core spawning servers through bridge `proc.spawn`, as a plugin would
* A tool list of its own for the brain, beside commands

## Decision Outcome

Chosen option: "a new crate that runs each server as `mcp:<name>`", because a server is then one more
provider in the command registry: agents find its tools with `cmd.tools`, run them with `desk-run` or by
name, and the person sees, allows and revokes them where every other grant lives. A plugin per server
would ask people to write manifests for programs they did not write; bridge `proc.spawn` cannot clear a
child's environment; a separate tool list would bypass the registry, undo and approvals.

* **The setup.** `mcp.servers.<name>` in init.yaml (`specs/init/v0`): `command`, `args`, and `env`, the
  names of variables to pass from the desk's environment, never values. Names are `^[a-z][a-z0-9-]{0,31}$`.
  Read at start; an edit applies at the next start.
* **The caller and its grant.** Each server is the caller `mcp:<name>` (`CallerId` in `specs/bridge/v0`
  takes it). When the runtime first reports ready, the host asks `perm.request` for
  `proc:spawn { commands: [command] }`, for always, with the command line and the variable names as the
  reason; a held grant answers at once. Refused, the server does not start this session. Revoked, it
  stops and its commands go.
* **The process.** The client starts it over stdio with a cleared environment: the variables the MCP
  SDKs pass by default (HOME, LOGNAME, PATH, SHELL, TERM, USER; the Windows set) and the named ones.
  The usual install folders follow the desk's PATH, as the local-agents plugin does (ADR 0084). Stopping
  closes its input, waits two seconds, then kills it. Its stderr goes to its log channel.
* **The protocol.** The client offers 2025-11-25 and takes 2024-11-05 to 2025-11-25. It declares no
  capabilities, answers `ping`, refuses sampling, roots and elicitation, follows `tools/list` pages and
  registers again on `notifications/tools/list_changed`.
* **Tools as commands.** `mcp.<name>.<tool>`: the tool name lowercased, every other character a dash,
  `-2` and up for clashes. Every one is `agent`, with the tool's description and its input schema as
  `argsSchema` when the schema compiles (else the server checks). The core decides what a manifest
  would: an `mcp:` provider's command is read-only when the server says `readOnlyHint`, and irreversible
  otherwise, so an agent's call of it waits for approval (ADR 0078); and it registers only its own
  `mcp.<name>.*` ids. A call answers `{ content, structuredContent? }`; `isError` fails the command.

### Consequences

* Good, because any MCP server becomes tools for Eris and every agent with four lines of init.yaml,
  and the permissions view names it "MCP server <name>".
* Good, because the safe reading is the default: a tool with no annotations waits for the person.
* Good, because a server sees only the variables named for it, not the desk's whole environment.
* Bad, because a server runs in the desk's process tree with the person's rights until the VM of
  ADR 0002 (M5): the grant decides whether it runs, not what it does.
* Bad, because the grant names the program, not its args: an edit of `args` under the same name runs
  without asking again. Renaming the server asks again.
* Bad, because `readOnlyHint` is the server's word; a server that lies about it skips approval.
* Bad, because a server that exits is not restarted until the next start.
* Bad, because values for `env` come from the desk's environment, which an app started from the Finder
  barely has; a keychain source (M5) comes later.

## More Information

Issue #471. Code: `crates/desk-mcp-client` (`rpc`, `session`, `process`, `tools`, `host`), the
`mcp:` rule in `crates/desk-core/src/core_tools.rs`, `apps/desk/src-tauri/src/mcp.rs`. Specs:
`specs/init/v0/init.schema.json` (`InitMcp`), `specs/bridge/v0/bridge.schema.json` (`CallerId`).
Builds on ADR 0002, 0016, 0072, 0078, 0084, 0086 and 0088.
