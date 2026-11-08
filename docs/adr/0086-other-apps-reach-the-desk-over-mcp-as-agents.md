---
status: accepted
date: 2026-11-04
decision-makers: Team endue
---

# Other apps reach the desk over MCP, as agents of their own

## Context and Problem Statement

People work with AI apps outside the desk: Claude Code, Claude Desktop, IDEs. Those apps speak MCP, and
they should be able to call Desk and work with its plugins: list what is installed, run any plugin's
command, read the items connectors bring in. The desk socket (ADR 0030) already reaches a running desk,
but only as `cli`, which holds `cmd:invoke ["*"]` and `fs:write` over `/**` and is never prompted or
held. An external app's model is exactly the attacker the threat model names, "an agent holding too many
grants, possibly prompt-injected". How does an MCP client reach the desk, which plugins can it use,
and under which caller do its calls run?

## Decision Drivers

* Every plugin in reach through one server, without a server per plugin
* The client's calls get what ADR 0072 and 0078 give agents: their own grants, the person's
  allowlist, a prompt on first use, approval with a preview for irreversible calls, the `perm` log
* No new network endpoint and no token: the socket's file mode stays the access check
* Existing MCP clients work unchanged (stdio, the published protocol versions)
* A client's tool list stays usable when the desk has a hundred commands

## Considered Options

* `desk mcp`, a stdio MCP server in the CLI over the socket, whose calls run as `agent:<id>`
* The same server, calling as `cli`
* An MCP server inside the app on a localhost HTTP port
* One MCP server per plugin

## Decision Outcome

Chosen option: "`desk mcp` over the socket, calling as `agent:<id>`", because it reuses the socket, the
permission engine and the agent rules as they are, and an MCP client gets no more than an agent of the
brain. `cli` would hand the client every file and command without a prompt; an HTTP port is a new
endpoint any local process can reach; a server per plugin cannot cross plugins.

* **The socket.** One request is the socket's own, not the bridge's: `{ id, method: "socket.agent",
  params: { agent } }` answers `{ caller: "agent:<agent>" }`, and from then on the connection calls
  as that agent. Only a `cli` connection may ask, once; an agent connection stays that agent, so a
  connection can narrow what it may do but never widen it. The id follows `specs/brain/v0`'s `agentId`.
* **The server** (`crates/desk-mcp`, `desk mcp [--agent <id>] [--plugin <id>]...`) speaks MCP
  2024-11-05 to 2025-11-25 on stdin and stdout and opens one connection per call, so a call waiting for
  the person holds up no other. The agent is `mcp` unless `--agent` names one; each app should name
  its own, so their grants stay apart.
* **Reading is `cli`, acting is the agent.** `list-plugins`, `list-commands` and the resources
  `desk://plugins` and `desk://plugins/<id>` read `plugin.list` and `cmd.list` as `cli`: the client
  sees what is installed, as any MCP server shows its tools. `run-command`, `call-bridge` (any bridge
  method by name, as the brain's tools are) and every command's own tool run as the agent.
* **Tools per command** only for the plugins `--plugin` names (`*` all, `desk` the runtime's): the name
  is the command id with dots as underscores, the input its args schema, `destructiveHint` the
  manifest's `irreversible`. Without `--plugin` the client has four tools that reach every plugin.
* **Changes.** A `cli` connection hears `cmd.changed` and `plugin.changed`; the client hears
  `tools/list_changed` and `resources/list_changed` once per burst, never before it is initialized.

### Consequences

* Good, because an external app can use every plugin, and the person sees, allows, caps and audits it
  the way they already do for agents of the brain.
* Good, because the bridge contract does not change: the socket's request lives in `desk-ipc`.
* Bad, because the agent id is the client's word, like the brain's: two apps that pass the same
  `--agent` share grants. The person's own process can always do more as `cli`, so it is no escalation.
* Bad, because the client sees every plugin and command name, granted or not.
* Bad, because a call without a `perm:manage` holder (no permissions view) is refused by the default
  prompter, and approvals have no task, so "Allow for this task" is never offered.
* Bad, because `call-bridge` reaches the methods that need no scope (`cmd.register`, `store.*`)
  without the allowlist's say, as the brain's agents do (ADR 0072).
* Bad, because the socket's Windows gap (ADR 0030) is this server's too.

## More Information

Issue #449. Code: `crates/desk-ipc/src/{wire,serve,client}.rs`, `crates/desk-mcp`, `crates/desk-cli`.
ADR 0030 (the socket), 0072 (agents are callers), 0078 (approvals). Threat model: "Bridge and
permission engine". The crate tree in `docs/ko/desk-structure.md` and PKG-02 in
`docs/ko/desk-requirements.md` get their lines in a later docs task.
