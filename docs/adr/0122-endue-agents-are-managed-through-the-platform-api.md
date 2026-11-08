---
status: proposed
date: 2026-11-07
decision-makers: Team endue
---

# endue agents are managed through endue AI's platform API, as studio.* on the bridge

## Context and Problem Statement

The person wants endue.ai's agent management (Home and Studio) on the desk as cards, and the cards
should create and manage agents through the API endue AI already provides. endue.ai's web calls endue
AI's own platform API (`/api/v1`: agent-service, agent-catalog-service, ai-agent-service behind the
api-gateway) with the person's endue ID token. Desk's only contract with endue AI so far is
`specs/brain/v0`, which endue AI does not serve today (no `/v0` route exists in `endue-ai/platform`) and
which has no agent CRUD, settings, prompt, catalog or conversation list. AGENTS.md says closed services
are reached "only through public contracts and their clients". How does the desk reach these
operations, who may use them, and how do their failures read?

## Decision Drivers

* The cards do what endue.ai does, against the same server, so the two never disagree
* The token stays in the core: no plugin holds it, no frame sees it, no Origin pretends to be a browser
* Closed services only through a written contract and a client crate, testable without the network
* Failures a person acts on (sign in, retry, not yours, gone, wrong value) are machine-readable
* Stay out of the brain contract's lane (#468: `specs/brain/v0`, `desk-brain-endue`)

## Considered Options

* Write the platform subset down as its own contract (`specs/platform/v0`, OpenAPI 3.1), call it from a
  `desk-platform` client crate, and serve it on the bridge as `studio.*` under a new `studio:manage`
* Grow `specs/brain/v0` with agent CRUD, facets, catalog and conversations, and ask endue AI to serve it
* Let the cards plugin call `/api/v1` itself with `net:fetch` and a token handed to it

## Decision Outcome

Chosen option: "its own contract, a client crate and `studio.*`".

* **The contract is what endue AI serves.** `specs/platform/v0/openapi.yaml` names only the operations
  Desk uses, with endue AI's own bodies (snake_case, three envelopes: bare, `{ data, meta }`,
  `{ success, data }`) and error envelope `{ error: { code, message } }`. Readers ignore fields it does not
  name and read `null` as absent, so endue AI can grow without breaking the desk. spec-lint compiles it
  and judges its vectors; `desk-platform`'s contract test reads every valid answer into its types.
* **One client.** `crates/desk-platform` sends `Authorization: Bearer <access token>` from the core's
  account through its public accessor, no Origin, waits 15 s (30 s to start from the catalog), and after
  a 401 refreshes once and tries once more. It goes through desk-sys's fetch (rustls, the system proxy,
  an allowlist of the base's host). The base is `https://platform.endue.ai`, `DESK_ENDUE_PLATFORM_URL`
  overrides it as it does for the sign-in. An in-process fake (feature `fake`) serves the tests.
* **The bridge speaks studio.\*.** `studio.agents.list|get|create|update|setStatus|remove`,
  `studio.agents.facets`, `studio.agents.prompt.update`, `studio.catalog.list|recommend|use` and
  `studio.conversations.list`, in the bridge's camelCase, served by the core. The core pages agent lists,
  reads Studio's seven facets side by side and names a facet that did not answer in `problems`, and
  computes each conversation's Home board column (`activity`).
* **studio:manage.** A new permission with no scope fields covers every studio method. A built-in plugin
  that declares it (the agent cards) holds it at install; any other caller asks the person.
* **Three new error codes.** `ErrorCode` gains `signed_out` (no endue ID, or a 401 one refresh did not
  cure), `offline` (out of reach or silent past the deadline) and `forbidden` (endue AI refused the
  person; `permission_denied` stays the desk's own refusal). 404 and 410 are `not_found`, 400 and 422
  `invalid_params`, anything else `io_error`. The WIT world has no such codes: there they are
  `permission-denied` and `io-error`.

### Consequences

* Good, because the cards and endue.ai share one server and one truth; nothing is mirrored on the desk.
* Good, because the token never leaves the core and the plugin needs no network grant.
* Good, because every test runs against the fake; the contract test catches drift between the written
  contract and the client's reading of it.
* Bad, because the contract follows a closed service Desk does not control: when endue AI renames a field
  the contract and the client follow by hand. Tolerant reading softens, not removes, that.
* Bad, because a 401 costs a session renewal (`Account::renew`, ADR 0111), which rotates the refresh
  cookie; a renewal that gives no new token answers `signed_out` and the call is not tried again.
* Bad, because the new error codes are visible to every caller of the bridge, not only studio.\*.
* Chatting with endue agents (runs over server-sent events), avatar upload, skill and connector binding,
  trait toggles and live updates of the Home board are left to later changes.

## More Information

Spec: `specs/platform/v0/`, `specs/bridge/v0/studio.schema.json`, `StudioManagePermission` in
`specs/plugin/v0/permission.schema.json`, `ErrorCode` in `specs/bridge/v0/bridge.schema.json`. Client:
`crates/desk-platform`. Core: `crates/desk-core/src/core_studio.rs`, `crates/desk-core/src/studio/`.
Browser stub: `packages/runtime/src/bridge/studio.ts`. The cards: #537. Builds on ADR 0089 (the account)
and sits beside ADR 0110 (`agents.*`, the agent programs on this computer). To overturn it, move these
operations into `specs/brain/v0` and serve them through `desk-brain-endue`.
