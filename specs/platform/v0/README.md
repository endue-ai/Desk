# endue AI platform API v0: the desk's subset

`openapi.yaml` (OpenAPI 3.1) writes down the part of endue AI's own platform API (`/api/v1`, what
endue.ai's web calls) that Desk uses to create and manage the person's endue AI agents (ADR 0122)
and to read the spaces they can open (ADR 0129). endue AI serves it; `crates/desk-platform` is Desk's
client, and the core serves it on the bridge as `studio.*` (`specs/bridge/v0/studio.schema.json`,
`studio-spaces.schema.json`) under `studio:manage`. The person's own account settings (ADR 0130) are
served as `account.settings.*` (`specs/bridge/v0/account.schema.json`) under `account:manage`.

| Area | Operations |
| --- | --- |
| Agents | `listAgents`, `createAgent`, `getAgent`, `updateAgent`, `deleteAgent` (soft), `setAgentStatus` |
| Studio facets | `getAgentIdentity`, `getAgentSettings`, `updateAgentSettings`, `getAgentPrompt`, `saveAgentPrompt`, `listPromptRevisions`, `restorePromptRevision`, `listAgentSkills`, `listAgentConnectors`, `listAgentTraits` |
| Catalog | `listCatalogAgents`, `recommendCatalogAgents`, `useCatalogAgent` |
| Conversations | `listConversations` (the Home board) |
| Spaces (read only) | `listSpaces` (with summaries), `getSpace`, `getSpaceOverview`, `listSpaceRooms` |
| Account | `getMe`, `updateMe`, `getMyPreferences`, `updateMyPreferences` (language, time zone), `getNotificationPreferences`, `updateNotificationPreferences` |

## Base, token and envelopes

- The base is `https://platform.endue.ai`; `https://platform.dev.endue.ai` is endue AI's development
  platform, and `DESK_ENDUE_PLATFORM_URL` overrides both.
- Every call carries `Authorization: Bearer <endue ID access token>` from the core's account. Desk
  sends no `Origin` header (no browser session), waits 15 s at most (30 s for `useCatalogAgent`), and
  after a 401 refreshes the token once and tries once more.
- agent-service answers the bare body for agents, identity, prompt, skills, connectors and traits, and
  `{ data, meta }` for settings. The catalog answers `{ data, meta }`; ai-agent-service (`/api/v1/ai`)
  answers `{ success: true, data }`. user-service answers the bare body; notification-service answers
  `{ data, meta }`. Errors are `{ error: { code, message, details?, suggest? }, meta }`.
  The space list and one space answer the bare body; a space's overview and rooms `{ data, meta }`.
- Bodies are snake_case. Readers ignore fields this document does not name and read `null` as absent,
  so endue AI can add fields without breaking Desk.
- Only what a card shows is named. People's ids, room members, a viewer's capabilities, attention
  items' reasons and anything about billing stay unnamed and unread, and nothing here names a host or
  a route other than the public gateway's.

## Errors on the bridge

| Platform | `studio.*` error code |
| --- | --- |
| no token, or 401 after one refresh | `signed_out` |
| unreachable, or silent past the timeout | `offline` |
| 403 | `forbidden` |
| 404, 410, and 409 on delete (already deleted) | `not_found` |
| 400, 422 | `invalid_params` |
| 409 on set status (it already has it) | none: the call succeeds |
| anything else | `io_error` |

## Vectors

`vectors/valid` and `vectors/invalid` hold `{ target, description, instance }` files whose target is a
component schema. `node scripts/spec-lint.mjs` and `crates/desk-platform/tests/contract.rs` judge each
as its folder says; the Rust test also reads every valid one into the client's types.
