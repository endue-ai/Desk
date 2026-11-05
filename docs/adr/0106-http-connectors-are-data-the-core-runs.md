---
status: accepted
date: 2026-11-05
decision-makers: Team endue
---

# Http connectors are data the core runs, and only the core reads their tokens

## Context and Problem Statement

A builder's day is in web services: GitHub issues and pull requests, a tracker, a calendar. ADR 0032 gave
connectors two bindings, a Wasm component and an MCP server in the VM, and ADR 0036 keeps an instance's
secret settings in the core, "never handed to the connector's code" and, until now, read by nothing. So
a service with a REST API needed a component compiled to Wasm, and that component could not hold the
token it needed to call the service. The first daily connector (GitHub, killer feature 3 of the roadmap,
ADR 0093) needs requests, pages and a token, and nothing to run besides.

## Decision Drivers

* The token never crosses the bridge and is never in a plugin's memory, Wasm or web
* A connector for a REST API is written in an afternoon, reviewed by reading it, shared without review
  like a view (ADR 0032)
* The permission engine still decides where the desk talks to: deny by default, per plugin
* No VM and no new runtime for the daily path

## Considered Options

* An `http` binding: requests, pagination and a JSON-to-item mapping declared in `plugin.json`, run by
  the core, which reads the token and sends it
* A Wasm connector with a new `http` import that attaches the token host-side by setting name
* An MCP server in the VM (the existing `mcp` binding)

## Decision Outcome

Chosen option: "an `http` binding", because the token then exists only in the core: it reads the
instance's secret setting and puts it in the one header `http.auth` names, on requests to the base URL's
origin. Each request needs the plugin's `net:fetch` grant for the base host, checked before every sync;
built-ins get theirs from the manifest like any permission, community ones ask. A sync reads every page
again (`maxPages`, 10 by default) and writes what is new or changed and removes what left, so v0 needs
no cursor. 401 and 403 are `error` with `reauth`. The core runs it in `desk-core`, beside the built-in
calendar connectors, not in the connector host, which never holds a secret. `desk.github` is the first.

### Consequences

* Good, because GitHub, and the next REST source, is a reviewed JSON file with no code, and Eris or the
  market can make and carry one like a view.
* Good, because the token is never in a frame, a Wasm store, connector.list, an event or an item, and a
  connector cannot send it anywhere but where the person connected it.
* Bad, because the mapping is deliberately small (pointers, `after`, `values`, `const`): a service whose
  records need real computation still needs a Wasm connector, which cannot use a token yet.
* Bad, because a full read each sync costs requests; a source with thousands of records needs a cursor,
  which a later version of the binding adds.
* Bad, because GitHub Enterprise and other per-instance base URLs are not expressible yet.

## More Information

`specs/connector/v0` (HttpBinding), `crates/desk-core/src/core_http.rs`, `core_http_sync.rs` and
`http_binding.rs`, `plugins/github`, Settings, Connections (`packages/runtime/src/settings-ui/connections.ts`).
ADR 0032, ADR 0036, ADR 0085 (the Projects adapter reads the record in `raw`), ADR 0093. Issue #473.
