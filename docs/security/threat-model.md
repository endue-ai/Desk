# Threat model

What Desk protects, from whom, at which boundary, and what stands at each boundary on `main` today.
"On main" means `main` at 79994bf (2026-10-29). Desk is pre-1.0 and has shipped no signed release, so
several boundaries exist only as decisions. Each gap names the open issue that closes it, or says
"no issue yet". When you find a way across a boundary, report it privately as [SECURITY.md](../../SECURITY.md)
says, not in a public issue.

The rule every boundary serves: a plugin or agent reaches a primitive only through the bridge, and the
bridge runs a call only when the person granted a permission that covers it.

## Assets

| Asset | Where it lives on main | What losing it means |
| --- | --- | --- |
| The person's files | Anywhere on disk. Reached through `fs.read` and `fs.list` under an `fs:read` scope; MCP tools would see only folders mounted into the VM (ADR 0002) | Disclosure or change of anything the person can read or write |
| Credentials and tokens | The brain's bearer token, an endue ID token for endue AI (`specs/brain/v0/openapi.yaml`). Desk holds none yet: `HttpBrain::with_token` is never called and nothing stores a token | Someone acting as the person towards endue or a third party |
| The endue ID session | The brain session and its lease; `brain.json` in the app data folder keeps the desk id and up to 200 transcript lines | Reading the conversation, or writing to a session as the person |
| Plugin data | `store.json` (one namespace per caller), `plugins.json` (enabled state), the plugin folders | One plugin reading or changing another's data or code |
| The desk's settings | `~/.desk/init.yaml` (or `DESK_INIT`), endue's copy (a mock file today) and `init.remote.yaml` after a conflict | A desk that starts with plugins off, or with settings someone else chose |
| Grants | The permission engine's grants, in memory for the session (`crates/desk-core/src/perm.rs`) | Every other asset: a grant is what a call needs |

## Attackers

| Attacker | Starts with | Wants |
| --- | --- | --- |
| A malicious plugin | Code the person installed, running as a UI frame, a Wasm instance or an MCP tool, calling the bridge as itself | Files, tokens or other plugins' data beyond its grants; the network without `net:fetch` |
| A compromised marketplace entry | A plugin changed after review, or a hostile update to one the person trusts | The same, from a plugin the person already trusts |
| A hostile page inside a surface | Content a plugin shows: a web page, a document, a message, text for an agent | To run script with the plugin's grants, or to steer the person or an agent |
| An agent holding too many grants | Brain tool calls or an agent plugin with broad grants, possibly prompt-injected | To use grants for something the person never meant |
| Another local user | Another account on the same machine | To read the desk's files: settings, store, transcript |
| A tampered sync copy | Write access to endue's copy of `init.yaml` or to its transport | To change how the person's desks start |

Not considered: someone with the person's own OS account (they can already do what Desk can), a
compromised OS or hardware, and endue's closed services themselves (report those to endue). A plugin that
slows the desk down is handled by turning it off, not by this model.

## Boundaries at a glance

| Boundary | Attackers | On main | Gaps |
| --- | --- | --- | --- |
| [UI plugin iframe](#ui-plugin-iframe) | plugin, hostile page | Sandboxed frame, CSP without network, caller named by frame | SVG without CSP, IPC reach untested (no issue yet) |
| [Wasm logic plugin](#wasm-logic-plugin) | plugin | Not run at all | The host, #39 |
| [MCP tool process and the VM](#mcp-tool-process-and-the-vm) | plugin, agent | Not run at all | The VM and supervisor (no issue yet) |
| [Bridge and permission engine](#bridge-and-permission-engine) | all | Deny by default, scopes never widened implicitly | No prompter (#64 and no issue yet), symlinks, Windows paths, dev folders (no issue yet) |
| [Brain and its lease](#brain-and-its-lease) | agent, plugin | Core holds the conversation; one writer per session | No TLS, no token storage (no issue yet) |
| [Marketplace](#marketplace) | marketplace entry | ADR 0005 only; `plugin-validate` checks this repository's plugins | Index, signing, verification (no issue yet) |
| [init.yaml sync](#inityaml-sync) | tampered copy | Schema check, both sides kept on conflict, no grants in the file | No authenticity, no real transport (no issue yet) |
| [The updater](#the-updater) | marketplace entry, network | Nothing: no updater, no signing | Signing, notarisation, updater (no issue yet) |
| [Local e2e and dev tooling](#local-e2e-and-dev-tooling) | local user, plugin | Read-only container, loopback servers, secret and dependency scans | Default network in the container, dev switches in release builds, file modes (no issue yet) |

## UI plugin iframe

A UI plugin is a folder of HTML, JS and CSS served over the `desk-plugin` scheme into an iframe
(ADR 0012).

On main:

- Frames get `sandbox="allow-scripts"` and nothing else (`packages/runtime/src/surfaces.ts`): an opaque
  origin, no forms, popups or top-level navigation.
- HTML responses carry `default-src 'none'`, `connect-src 'none'`, `frame-src 'none'` and
  `form-action 'none'`, allowing scripts, styles, images and fonts from the scheme only
  (`apps/desk/src-tauri/src/protocol.rs`). A plugin cannot fetch, embed or post anywhere.
- The runtime knows which plugin calls by the frame a `postMessage` comes from
  (`packages/runtime/src/plugins.ts`) and forwards the call under that plugin's id, so a plugin can
  only call as itself.
- Only the main window holds a Tauri capability, limited to `bridge_call`, `desk_ready` and core events
  (`apps/desk/src-tauri/capabilities/default.json`). `withGlobalTauri` is off, and the app's own CSP
  lets the main webview connect to IPC only (`apps/desk/src-tauri/tauri.conf.json`).
- The core serves a plugin's files only from inside its folder (`crates/desk-core/src/manifest.rs`).

Gaps:

- The CSP is attached to `text/html` responses only. Other documents a frame can render, such as SVG,
  arrive without it. No issue yet.
- `'unsafe-inline'` is allowed for scripts, so a plugin that inserts hostile content as HTML runs it
  with the plugin's grants. The grants still bound the damage. No issue yet.
- Nothing tests that a plugin frame cannot reach Tauri IPC. The core trusts the caller name the main
  webview passes to `bridge_call` (`apps/desk/src-tauri/src/commands/bridge.rs`), so that claim
  carries the whole boundary. No issue yet.
- The runtime e2e fixture serves plugins without this CSP, so no test exercises it. No issue yet.

## Wasm logic plugin

On main, logic plugins do not run: `crates/desk-plugin-host` is an empty crate and the runtime mounts
only `ui` plugins. The core still records `logic` and `tool` plugins as installed.

Design: each plugin is a Wasmtime component behind `desk:host` (`specs/wit/desk-host.wit`), whose imports
go through the same permission engine, with a memory limit and an epoch time limit per instance, and a
trap in one instance never affecting another.

Gap: the host itself, #39.

## MCP tool process and the VM

On main, nothing runs: `crates/desk-vm` is an empty crate and no tool plugin is started.

Design (ADR 0002): every MCP tool runs inside one lightweight Linux VM. Only folders the person allowed
are mounted (virtiofs), the host talks to tools over vsock, and the VM stops when idle. A device that
cannot run the VM tells the person at install time that tools run unisolated.

Gaps: the VM, the tool supervisor, and a permission check on every tool call. No issue yet.

## Bridge and permission engine

Every call from a plugin or the runtime reaches the core through one command and one handler
(`crates/desk-core/src/handler.rs`).

On main:

- Deny by default. `PermissionEngine::authorize` (`crates/desk-core/src/perm.rs`) runs a call only when
  its scope covers the target (the path) and one of the caller's grants covers the scope. Anything else
  answers `permission_denied` with the missing permission.
- Scopes are never widened implicitly. A scope wider than every grant is denied; the only way to add a
  grant is `perm.request`, which the person answers. In the app nobody can answer yet: the core's
  default prompter refuses every request, so only built-in plugins hold grants (the permissions their
  manifests declare, `crates/desk-core/src/core_plugins.rs`), and the runtime holds `plugin:manage`.
- Grants last for the session and live in memory; `once` and `always` are refused, and so is revoking
  another caller's grant.
- Paths are normalised lexically, and `..` above a root is rejected (`crates/desk-core/src/paths.rs`).
- `store.*` keeps one namespace per caller. Methods the core does not serve yet (`fs.write`, `proc.*`,
  `net.fetch`, `audio.*`, `ui.*`, `cmd.*`, `settings.*`, `log.*`, `events.*`, `perm.list`, `perm.answer`)
  answer `unsupported`.

Gaps:

- No prompter: `perm.request` is always refused in the app. #64 builds the prompter plugin; the core
  side of prompts and grant persistence has no issue yet.
- Path checks are lexical. A symlink inside an allowed folder that points outside it is followed by
  `fs.read`. No issue yet.
- The core splits bridge paths on `/` only and does not enforce the schema's no-backslash rule, so on
  Windows a segment with backslashes can name a folder other than the one the scope was checked
  against. No issue yet.
- Every plugin under `DESK_PLUGIN_DIRS` installs as built-in with its declared permissions granted, in
  release builds too. Grants are keyed by plugin id, so a plugin installed later under a built-in's id
  holds that id's grants. No issue yet.

## Brain and its lease

The core owns the conversation (ADR 0014): plugins call `brain.say` under `brain:converse` and receive
only their own turns. They never hold brain credentials or reach the network.

On main:

- The brain URL comes from `DESK_BRAIN_URL` and defaults to `http://127.0.0.1:8787/v0`
  (`examples/brain-echo`). The client refuses `https` (`crates/desk-brain-endue/src/http.rs`) and sends
  no token.
- A session has one writer: the lease holder. When another desk takes the lease over, this desk turns
  read-only and refuses to write (`crates/desk-core/src/lease.rs`). The first turn of each run takes
  the lease over.
- Tools the brain asks for run in the core, not in a plugin. The only tool is `echo`, which touches
  nothing (`crates/desk-core/src/conversation.rs`).

Gaps:

- No TLS, so a brain anywhere but this machine would be reached in plain HTTP. No issue yet.
- No token storage: tokens belong in the OS keychain only. No issue yet (#65 lists it as a requirement).
- Brain tools that touch files or the network need the permission engine and a record of what an agent
  did with each grant. No issue yet.

## Marketplace

On main there is no marketplace: plugins load only from folders on disk (`DESK_PLUGIN_DIRS`,
`DESK_DEV_PLUGINS`).

Decided (ADR 0005): every submission is checked automatically (manifest, permission vocabulary, static
scan), signed by the marketplace when published, and sent to manual review when it asks for broad
`proc` or `net` permissions. Desk installs only bytes whose marketplace signature checks out, so the
installed bytes are the reviewed bytes. The `plugin-validate` workflow already runs `desk plugin
validate` on every plugin in this repository.

Gaps: the index, signing, verification at install time, and asking again when an update wants more
permissions. No issue yet (#65 lists them as requirements).

## init.yaml sync

The core syncs the whole file through a `SyncRemote` (ADR 0016). Until endue serves sync, `MockRemote`
keeps endue's copy in `sync-mock.json` in the app data folder.

On main:

- A pulled copy must parse and validate against `specs/init/v0` and a version Desk reads before it
  replaces the local file (`crates/desk-core/src/sync.rs`, `init.rs`). Writes are atomic.
- When both sides changed, the local file stays and endue's copy is saved next to it as
  `init.remote.yaml`, so no edit is lost.
- The file can only pick the mode, start plugins disabled, set settings and turn sync on. It cannot
  grant permissions or install plugins.

Gaps:

- No authenticity: nothing shows a copy came from the person's own desks. The digest (FNV-1a) only
  tells versions apart. A plugin that trusts a setting as if the person typed it can be steered by a
  tampered copy. No issue yet.
- No real transport and no endue ID sign-in yet. No issue yet (#65 lists it as a requirement).

## The updater

On main there is no updater: no Tauri updater configuration, no release workflow, no code signing and
no notarisation. The install smoke test with its signature check is planned (`docs/qa/TESTING.md`) and
does not exist yet.

Design (`docs/ko/desk-structure.md`, "GitHub 와 오픈소스 뼈대"): `canary.yml` and `release.yml` build on
three OSes, sign and notarise, run the install smoke test and publish an updater manifest per channel.
The signing keys and the updater's private key live in a protected `signing` environment that AI tokens
cannot reach (`AGENTS.md`, "Boundaries").

Gaps: OS signing, notarisation, the updater and its key. No issue yet (#65 lists them as requirements).

## Local e2e and dev tooling

On main:

- On macOS the runtime e2e runs in a Linux container (ADR 0018). The checkout is mounted read-only,
  only snapshots and results are writable, memory is capped and no port is published
  (`scripts/e2e/container.mjs`).
- Development servers bind to loopback: the e2e fixture server and `examples/brain-echo` on
  `127.0.0.1`, the app's dev server on `localhost`. brain-echo accepts any token, which is fine only
  because it is local.
- CI scans dependencies and secrets on every PR (`.github/workflows/security.yml`: cargo-deny,
  cargo-audit, `pnpm audit`, gitleaks), and Dependabot proposes updates.
- An agent hook blocks direct Playwright commands (`scripts/agent-hook.mjs`).

Gaps:

- The e2e container keeps Docker's default network, though the tests serve their fixtures inside it.
  No issue yet.
- `DESK_PLUGIN_DIRS`, `DESK_DEV_PLUGINS`, `DESK_BRAIN_URL` and `DESK_INIT` work in release builds too.
  No issue yet.
- Desk writes its files with the default umask, so another local user can read `init.yaml`,
  `store.json` and the transcript in `brain.json` wherever the home folder lets them. No issue yet.

## Keeping this page true

Change this page in the PR that moves a boundary: a mitigation that lands moves from Gaps to On main,
and a new gap names its issue. ADRs record why; this page records what stands today.
