# endue Desk architecture

English · [日本語](i18n/ja/architecture.md) · [中文](i18n/zh/architecture.md) ·
[Français](i18n/fr/architecture.md) · [Deutsch](i18n/de/architecture.md) · [한국어](i18n/ko/architecture.md)

This is the English summary of the design. The source of truth is `docs/ko/desk-structure.md`; decisions
that are hard to reverse are in `docs/adr/`.

Desk is one OS built as one app: a Tauri shell and a small Rust core carry a web runtime, and every
feature on top of that runtime is a plugin. Like Emacs, the core keeps only primitives and everything else
can be changed while the app is running.

## At a glance

```text
 off the device ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 ┆  endue AI (cloud brain: agentic loop · models · credits)      changed on the server ┆
 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│ specs/brain ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 the user's computer               │                           cost of change
 ┌─────────────────────────────────┴──────────────────────────────┐
 │ Plugins      UI (iframe) · logic (Wasm) · tools (MCP, in a VM) │  instant
 │              · connectors (Wasm · MCP) · views (data)          │
 ├────────────────────────────────────────────────────────────────┤
 │ Web runtime  compositor (3D/2D) · surfaces · input · layout    │  restart
 │              · UI plugin host · desk shell (until ADR 0026)    │
 ├────────────────────────────────────────────────────────────────┤
 │ Desk bridge  specs/bridge · specs/item · specs/view            │  rebuild
 │              · specs/connector → TS client · Rust types        │
 ├────────────────────────────────────────────────────────────────┤
 │ Rust core    permissions · event bus · storage · item index    │  rebuild
 │              · logic plugin and connector host (Wasm) · VM     │
 │              · built-in connectors · brain clients             │
 ├────────────────────────────────────────────────────────────────┤
 │ Tauri shell  windows · webviews · primitives (fs, proc, net,   │  rebuild
 │              audio)                                            │
 ├────────────────────────────────────────────────────────────────┤
 │ OS           macOS · Windows · Linux (signing, notarisation,   │  —
 │              OS permissions)                                   │
 └────────────────────────────────────────────────────────────────┘
```

Higher layers change while the app runs; lower layers need an app update. Only endue AI lives off the
device. Everything else runs on the user's computer.

| Layer | Folders |
| --- | --- |
| endue AI (cloud) | outside the repository; only `specs/brain` and `crates/desk-brain-endue` live here |
| Plugins | `plugins/` · `packages/plugin-sdk` · `specs/plugin` · `specs/wit` · `examples/` |
| Web runtime | `packages/runtime`: the compositor, the UI plugin host (ADR 0012) and, until ADR 0026 is decided, the desk shell (ADR 0025) · `packages/ui` |
| Desk bridge | `specs/bridge` · `specs/item`, `specs/view` and `specs/connector`, the integration layer's contracts (ADR 0032) · `packages/bridge` · `crates/desk-bridge` (types generated from these and `specs/plugin`) |
| Rust core | `crates/desk-core`, which also serves the integration layer (`data.*`, `connector.*`, `view.*`, `catalog.get`) and defines the built-in connectors `desk.calendar` and `desk.reminders` over the OS calendar (ADR 0036, proposed) · `crates/desk-index`, the item index in one SQLite file (ADR 0033) · `crates/desk-plugin-host`, which runs logic plugins (ADR 0019) and Wasm connectors (ADR 0034, proposed) on Wasmtime · `crates/desk-vm` · `crates/desk-brain*` |
| Tauri shell | `apps/desk/src-tauri` · `crates/desk-sys` |
| OS | `apps/desk/src-tauri/capabilities` · release workflow (signing, notarisation) |

## Like Emacs, like an OS

Emacs runs almost everything in Elisp on top of a small C core, and you can change it while it runs. Desk
takes the same shape and names the parts the way an operating system would.

| Role | Operating system | Emacs | Desk |
| --- | --- | --- | --- |
| Kernel | kernel | C core | Rust core |
| System calls | syscalls | Lisp primitives | Desk bridge API |
| Drivers | device drivers | OS glue | Tauri shell + Rust crates |
| Window manager | window manager | frames · windows | 3D canvas compositor |
| Shell | terminal shell | M-x | Eris · command palette |
| Apps | applications | packages (Elisp) | plugins (UI · Wasm · MCP) |
| Connected data | mounted file systems · search index | Gnus back ends · Org agenda | connectors · items in one index · views (ADR 0032) |
| Boot config | init | init.el | `init.yaml` (profile + plugins + settings) |
| Package manager | apt · brew | package.el · MELPA | marketplace |
| Behaviour override | none | advice · hooks | event hooks · command overrides |
| Accounts | user accounts | none | endue ID |

Six principles follow from this:

1. **Small core.** The Rust core holds primitives (fs, proc, net, audio, ui), not features.
2. **Built-ins are plugins.** Eris, the sidebar, the toolbar and profile switching use the same API as
   community plugins, so the API has no holes and even built-ins can be replaced. The desk's default
   policies (where surfaces go, keys, files, themes, notifications) are data-only `desk.*` plugins too
   (ADR 0017). The desk shell (`mountDesk`) is not there yet: it is code in `packages/runtime` (ADR 0025)
   until ADR 0026, still proposed, decides where it lives. Until then Eris exists twice, as `plugins/eris`
   and in the shell (ADR 0027), and so do the desk's edges, as the dock, toolbar and sidebar plugins and
   the shell's bottom edge, rail and agent bar (ADR 0028).
3. **Everything is a command.** Clicks, voice, shortcuts and agents call the same commands. Whatever a
   person can do, Eris and agents can do too.
4. **Change it while it runs.** Saving a plugin reloads it; plugin state lives in core storage and
   survives the swap.
5. **Hook into anything.** Any command can get hooks before and after it, or be replaced outright, like
   Emacs advice.
6. **Ask before looking.** Every primitive call, from a person or an agent, passes the bridge's
   permission check.

## What changes, and how fast

```text
 ┌─ rebuild ──────────────────────────────────────────────────────┐
 │  Rust core · Tauri shell · bridge types   restart after update │
 │  ┌─ restart ────────────────────────────────────────────────┐  │
 │  │  web runtime                         window reload, ~2 s │  │
 │  │  ┌─ instant ──────────────────────────────────────────┐  │  │
 │  │  │  one plugin (iframe · Wasm · MCP)           < 1 s  │  │  │
 │  │  └────────────────────────────────────────────────────┘  │  │
 │  └──────────────────────────────────────────────────────────┘  │
 └────────────────────────────────────────────────────────────────┘
```

The further in, the cheaper the change. For users a rebuild is one restart after an automatic update; for
developers it also means compiling, signing and notarising.

| Scope | What reloads | Target | What carries on |
| --- | --- | --- | --- |
| Instant | the changed plugin (iframe, Wasm instance or MCP process) | under 1 s | other surfaces, running work, voice standby |
| Restart | the web runtime (window reload) | about 2 s | the Rust core, MCP tools, running CLIs |
| Rebuild | the whole app (relaunch after an automatic update) | download time + a few seconds | saved state, profiles, installed plugins |

Development uses the same three steps: plugin folders reload on save, the web runtime uses Vite HMR, and
the Rust core rebuilds with `cargo watch`.

## Contracts

`specs/` draws the line between open and closed. The bridge, brain and plugin types are generated from
it into Rust and TypeScript, and both sides test against the same vectors. See `specs/README.md`.
