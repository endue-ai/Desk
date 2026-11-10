# endue Desk architecture

English · [日本語](i18n/ja/architecture.md) · [中文](i18n/zh/architecture.md) ·
[Français](i18n/fr/architecture.md) · [Deutsch](i18n/de/architecture.md) · [한국어](i18n/ko/architecture.md)

This is the English summary of the design. The source of truth is `docs/ko/desk-structure.md`; decisions
that are hard to reverse are in `docs/adr/`.

Desk is one OS built as one app: a Rust shell on Chromium (CEF) and a small Rust core carry a web runtime. The runtime
owns settings, keyboard bindings and their persistence. Other features on top are plugins. Like Emacs,
the Rust core keeps primitives while plugins can be changed while the app is running.

The shell and the screen are changing: Desk has moved from Tauri and the OS webviews to a Rust shell on
Chromium (CEF), and moves on to a compositor of its own in which every window renders in its own process
([ADR 0140](adr/0140-a-wgpu-compositor-over-cef-off-screen-surfaces.md)). Stage 1 ended with the Tauri
shell deleted; the shell described below is the CEF one. "Where the shell and the screen are going",
below the layer table, has the stages.

## At a glance

```text
 off the device ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 ┆  endue AI (cloud brain: agentic loop · models · credits)      changed on the server ┆
 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│ specs/brain ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 the user's computer               │                           cost of change
 ┌─────────────────────────────────┴──────────────────────────────┐
 │ Plugins      UI (iframe) · logic (Wasm) · tools (MCP, in a VM) │  instant
 │              · connectors (Wasm · MCP · http) · views (data)   │
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
 │ Shell (CEF)  windows · browsers · primitives (fs, proc, net,   │  rebuild
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
| Web runtime | `packages/runtime`: the desk's system surface (ADR 0160): the UI plugin host (ADR 0012), the policies and, until ADR 0026 is decided, the desk shell's parts (ADR 0025); it lays out no window and holds no plugin frame in the app · `packages/ui` |
| Desk bridge | `specs/bridge` · `specs/item`, `specs/view` and `specs/connector`, the integration layer's contracts (ADR 0032) · `packages/bridge` · `crates/desk-bridge` (types generated from these and `specs/plugin`) |
| Rust core | `crates/desk-core`, which also serves the integration layer (`data.*`, `connector.*`, `view.*`, `catalog.get`) and defines the built-in connectors `desk.calendar` and `desk.reminders` over the OS calendar (ADR 0036, proposed), and runs http connectors from their manifests, reading their tokens itself (ADR 0106) · `crates/desk-index`, the item index in one SQLite file (ADR 0033) · `crates/desk-plugin-host`, which runs logic plugins (ADR 0019) and Wasm connectors (ADR 0034, proposed) on Wasmtime · `crates/desk-vm` · `crates/desk-brain*` |
| Shell (CEF) | `apps/desk/shell`, the app `endue-desk` on winit and CEF (ADR 0143), and `crates/desk-web`, what its URL schemes answer and which caller each page is, without the engine · `crates/desk-sys` · `crates/desk-computer`, computer use on macOS (screenshots, the accessibility tree, input, apps), which the core serves as `computer.*` under `computer:see` and `computer:control`, each act of an agent waiting for the person's approval (ADR 0120, ADR 0123) |
| OS | `apps/desk/shell/packager`: the bundles, CEF's helper apps and their entitlements (ADR 0145) · release workflow (signing, notarisation) |

## Where the shell and the screen are going

Until Stage 1 the desk was one Tauri window with one OS webview, and every plugin window a sandboxed
iframe in that one page. The shell and all plugins shared one process and one main thread, so a plugin
that looped stalled the whole desk, and WebGPU was missing on Linux. ADR 0140 changes that: every window
renders in its own process, and a compositor of Desk's own, on wgpu, places what they render. Since Stage
1 every plugin surface is its own Chromium renderer, so a dead renderer costs its window only. Since #83
the compositor is the only desk (ADR 0156): every plugin surface renders off screen in a browser of its
own, the compositor draws it where `crates/desk-wm` places its window, and desk-wm runs the window
gestures, the window commands and the live budget. What stays web runs as system surfaces the
compositor places above every window (ADR 0160): the desk's own page (the bars, Eris, notices, menus,
settings and the studios, each part drawn whole), the palette's window and floating Eris's, each calling
as its window. No plugin runs in the desk's page: its plugin host reaches each plugin's own browser
through the shell.

```text
 desk (Rust, one process): winit · compositor (wgpu) · CEF host · core · updater
        │ surface             │ surface             │ surface              │ no surface
 web plugin             web plugin            native plugin          logic plugin
 (CEF renderer)         (WebGPU, 3D)          (its own process)      (Wasm, unchanged)
 each: its own process · its own main thread · its own GPU queue · a crash empties one window
```

| Stage | What changes | State |
| --- | --- | --- |
| 0 | On the Tauri app: each surface gets its own origin on the `desk-plugin` scheme; only the windows in sight and the 8 most recently focused keep a live frame; heavy work moves to workers; a frame that stops answering offers Wait or Stop on its window | done |
| 1 | The shell becomes a Rust binary on winit and CEF (`apps/desk/shell`, ADR 0143) showing today's shell page, and Tauri is removed; every plugin iframe is its own Chromium renderer; app-level e2e drives it over Chromium's remote debugging (ADR 0144) | done (#97): the CEF desk replaced the Tauri app under its name, `endue-desk`, and canary builds it; WebGPU on Windows and Linux is checked on those OSes (#61), and the first beta that installs through the updater comes with the next release line |
| 2 | The compositor (`crates/desk-compositor`) draws the desk and places each surface's texture; surfaces speak one protocol (`specs/surface`, ADR 0141); CEF renders each plugin off-screen; the window manager moves from `packages/runtime` to Rust | in progress: the compositor is the only desk, and desk-wm places every window and runs its gestures, commands and the live budget (#83); what stays web runs as system surfaces, with no plugin in the desk's page (#55); the spread's visuals are next |
| 3 | Native plugins: a process that speaks the surface protocol and the bridge over `desk.sock` | planned |

Plugin code does not change at any stage: the manifest, the SDK and the bridge's wire format stay. A
plugin gains its own process and origin, and WebGPU on every OS. Only the windows in sight and the 8 most
recently focused keep a live process; the rest sleep with their state (ADR 0142). A proof of concept on
macOS composited 30 off-screen CEF surfaces with wgpu, ran WebGPU inside them, and kept the others
painting while one renderer was killed; a light renderer cost about 40 MiB
(`spikes/compositor/README.md`). Windows and Linux are still to run.

## Like Emacs, like an OS

Emacs runs almost everything in Elisp on top of a small C core, and you can change it while it runs. Desk
takes the same shape and names the parts the way an operating system would.

| Role | Operating system | Emacs | Desk |
| --- | --- | --- | --- |
| Kernel | kernel | C core | Rust core |
| System calls | syscalls | Lisp primitives | Desk bridge API |
| Drivers | device drivers | OS glue | the shell (winit, CEF) + Rust crates |
| Window manager | window manager | frames · windows | 3D canvas compositor |
| Shell | terminal shell | M-x | Eris · command palette |
| Apps | applications | packages (Elisp) | plugins (UI · Wasm · MCP) |
| Connected data | mounted file systems · search index | Gnus back ends · Org agenda | connectors · items in one index · views (ADR 0032) · universal views over any source of one YAML format (ADR 0087) |
| Boot config | init | init.el | `init.yaml` (profile + plugins + settings) |
| Package manager | apt · brew | package.el · MELPA | marketplace |
| Behaviour override | none | advice · hooks | event hooks · command overrides |
| Accounts | user accounts | none | endue ID |

Six principles follow from this:

1. **Small core.** The Rust core holds primitives (fs, proc, net, audio, ui), not features.
2. **Built-ins are plugins.** Eris, the sidebar, the toolbar and profile switching use the same API as
   community plugins, so the API has no holes and even built-ins can be replaced. The desk's default
   policies (where surfaces go, files, themes, notifications) are data-only `desk.*` plugins too
   (ADR 0017). Settings and default keys are core facilities, always available without plugins
   ([ADR 0055](adr/0055-core-settings-and-keybindings.md)); plugins may add bindings. The desk shell
   (`mountDesk`) is not there yet: it is code in `packages/runtime` (ADR 0025)
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
 │  Rust core · Shell (CEF) · bridge types   restart after update │
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
