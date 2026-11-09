---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

# Desk composites every window from its own process: a wgpu compositor over CEF off-screen surfaces

## Context and Problem Statement

The desk is one Tauri window holding one WKWebView. The shell runtime and every plugin surface live
in that one page: a plugin is an `<iframe sandbox="allow-scripts">` inside a shell window (ADR 0040),
and every plugin loads from one host, `desk-plugin://localhost/<id>/…` (ADR 0012). WebKit does not
give iframes processes of their own, so the shell and all plugins run on one WebContent process and
one main thread. A busy loop in one plugin stalls the whole desk, and a memory blow-up in one takes
the page down. Workers (ADR 0048) move parsing off that thread, but the JavaScript, DOM, style and
layout of every window still share one core. WebGPU in WebKit is Metal-only: WebKitGTK has none and
macOS needs version 26. The Rust core is multi-threaded already; the UI page is the single-threaded
part. How does every window get its own process, main thread and GPU queue on all three OSes, while
plugins stay HTML, JavaScript and the SDK?

## Decision Drivers

* Portable: one code path on macOS, Windows and Linux, and later a path to running as a session on
  DRM/KMS without an OS desktop underneath
* A window never blocks another; N windows use N cores; a crash or a hang costs that window only
* The desk's own drawing (chrome, effects, the spread view) is a shader away
* Plugins stay HTML, JavaScript and `@endue-ai/plugin-sdk`, on one engine: "runs in Chrome" means
  "runs in Desk"
* WebGPU in every plugin on every OS, so people can build 3D (roadmap G1 and G8, ADR 0093)

## Considered Options

* A · CEF under the current shell: the shell page's iframes become out-of-process frames
* B · OS webviews as OS layers (CALayer, DirectComposition, GTK), one per window
* C · Wait for WebKit to isolate sites
* D · A wgpu compositor in Rust over CEF off-screen surfaces

| | A · CEF under the shell | B · OS webviews as layers | C · wait for WebKit | D · wgpu + CEF off-screen |
| --- | --- | --- | --- | --- |
| One process per window | yes | yes | later | yes |
| One code path | yes | no: three compositors, three engines | yes | yes (texture import is the only per-OS part) |
| The desk's own GPU and shaders | no: a DOM compositor | no: OS effects only | no | yes |
| WebGPU on every OS | yes | no: none in WebKitGTK, macOS 26+ | no | yes |
| Window manager changes | none | large | none | large (it moves to Rust) |
| Resources | high (bundled Chromium) | lowest | lowest | high (bundled Chromium) |
| Maturity | CEF stable | Tauri multiwebview unstable, no transforms | not shippable | CEF's shared-texture OSR stable; the `cef` crate imports it into wgpu |

## Decision Outcome

Chosen option: "D", reached through A, because it is the only option that meets every driver. A and
D share the engine, so A is D's first stage, not a competitor. B fails portability, the desk's own
GPU and WebGPU; C fails WebGPU and has no date. We accept D's cost in memory and in Chromium's release
cadence because the drivers are the product, and the live budget (ADR 0142) keeps memory bounded.

* Everything on screen is a surface: a texture that a process rendered, placed by the compositor. A
  Rust compositor on wgpu (Metal, DX12, Vulkan) draws the desk itself (wallpaper, window chrome,
  bars, effects, overlays) and samples each window's content from the GPU texture its own process
  rendered. The model is a Wayland compositor's.
* Web plugins render through CEF (Chromium) off-screen into shared textures (IOSurface on macOS, a
  D3D11 shared handle on Windows, DMA-BUF on Linux), which the compositor imports. Native plugins
  will render through the same contract (ADR 0141).
* One CEF renderer per web surface: every surface has an origin of its own and `--site-per-process`
  is on, so Chromium cannot merge them; the renderer limit follows the live budget (ADR 0142). CEF's
  GPU, network and utility processes are shared, as WebKit's were. The desk's own process
  (compositor, core, tray, updater) never runs plugin code.
* Tauri and the OS webviews go. The app shell is a Rust binary on winit and CEF (ADR 0143).
* The plugin SDK and the bridge's wire shapes do not change; plugins written today run unchanged.

### Stages

Each stage ships on its own, and none is thrown away, because every stage uses the same engine.

| Stage | What lands | Exit |
| --- | --- | --- |
| PoC | `cef` off-screen surfaces imported into wgpu; WebGPU inside them; 10 and 30 surfaces (#33–#35) | P1, P2 and P3 pass |
| 0, on Tauri | an origin per surface (#36); the live budget (#37); heavy work in workers (#38); "Not responding" on one window (#39) | each lands on the current app |
| 1, option A | the Rust shell with windowed CEF shows today's shell page, Tauri removed (ADR 0143); `desk-web` serves the scheme and carries the bridge over CEF messages; e2e over remote debugging (ADR 0144) | every iframe is its own renderer; killing one leaves the others working; WebGPU in a plugin on three OSes; a beta installs through the updater |
| 2, option D | `specs/surface` (ADR 0141); `desk-compositor`; CEF off-screen per surface; the window manager moves to Rust; palette, Eris, bars and settings become system surfaces | no DOM composites plugin surfaces; compose in 4 ms or less with 15 live surfaces; today's shell e2e passes |
| 3 | the `native` plugin kind over `specs/surface` and `desk.sock`; a DRM/KMS session spike on Linux | — |

### Proof of concept

On macOS 26.5.1, Apple M4 Max, CEF 156.0.26 (`cef` crate 156.4.0), wgpu 30, a release build, with
the screen locked, so frames were composed off-screen and checked as PNG (`spikes/compositor`):

| Check | Result on macOS |
| --- | --- |
| P1, import | IOSurface → `MTLTexture` → wgpu through `cef::osr_texture_import`, BGRA8, no software paints; first paint 137–248 ms after `CreateBrowser`; 57–59 fps at 1920x1080 with one animating surface; 0.45–0.57 ms per imported paint; a resize reaches the texture and the quad follows |
| P2, WebGPU | works without flags: adapter `apple / metal-3`, not the fallback adapter, 120+ frames; WebGL2 works through ANGLE on Metal. The design's one unverified link holds on macOS |
| P3, scale and isolation | 30 surfaces start with every first paint under 470 ms; a light renderer costs ~40 MiB; `kill -9` of one renderer among four: CEF reports it in 60 ms, the surface reloads and paints 50 ms later, and the other three keep 53 paints/s throughout; Korean IME (`ImeSetComposition`, `ImeCommitText`) gives `한글` and the caret rectangle back |

Windows (D3D11 → DX12) and Linux (DMA-BUF → Vulkan, Wayland and X11) are not run yet; #61 holds those
checks. If Chromium's off-screen path cannot carry WebGPU on one of them, that surface composites in
Chromium (a windowed CEF browser) until it can.

The macOS message pump binds the shell: calling CEF's `do_message_loop_work` when CEF did not ask
for it blocks about 60 ms per call (13 fps), while calling it only when `OnScheduleMessagePumpWork`
schedules it, at most 33 ms apart, gives 57–59 fps. The shell drives CEF from that schedule inside
winit's event loop (ADR 0143).

### What this changes in earlier decisions

* ADR 0001 (Tauri over Electron) is superseded. Its way out, "swap the shell for Electron or CEF by
  reimplementing only the bridge", is the way taken.
* ADR 0012 is amended. The scheme still serves plugin files, `fs.url` ranges and the SDK, but every
  surface gets an origin of its own (the host names the surface and the plugin; #36 fixes the
  syntax), and once CEF serves it the scheme has one form on every OS (Windows'
  `http://desk-plugin.localhost` goes). The `sandbox` attribute ends with the iframes in Stage 2:
  isolation then comes from Chromium's process sandbox, the per-surface origin, the CSP, and a
  handler in the browser process that refuses any request to an origin outside the desk's schemes.
  The caller of a bridge call becomes the identity the browser process knows for the surface, not a
  name the runtime passes (#43).
* ADR 0040 is amended. In Stage 2 the window manager (placement, drag, resize, snap, pin, drawer,
  spread, tiling, focus order and the drag-and-drop broker) moves from `packages/runtime` to the
  compositor in Rust. Until then the shell's windows hold the plugin surfaces as ADR 0040 says.
* ADR 0048 is amended. The CSP's sources become scheme-wide (`desk-plugin:`, plus
  `http://*.desk-plugin.localhost` while WebView2 serves Windows), since each surface is its own
  host. Workers, `'wasm-unsafe-eval'` and `fetch` with `Range` stay as they are.

### Consequences

* Good, because a plugin that loops, leaks or crashes costs its own window; the desk keeps drawing
  and taking input through it.
* Good, because N windows use N cores, each with its own GPU queue.
* Good, because one engine runs on every OS: WebGPU in plugins everywhere, one visual baseline, and
  no WebKitGTK gap on Linux.
* Good, because the desk's chrome and effects are ours to draw, and a snapshot of any window is free
  (the texture is ours) for the minimap, the spread view and sleeping placeholders.
* Bad, because the download grows by roughly 150–200 MB (to be measured), and memory starts at a
  base of about 0.9 GiB on macOS (ADR 0142).
* Bad, because Desk rides Chromium's four-week security train: a CEF bump ships through the beta
  line within two weeks of a Chromium stable with security fixes (ADR 0092, ADR 0054).
* Bad, because the window manager is rewritten in Rust in Stage 2, and accessibility must be built
  from CEF's trees through AccessKit (ADR 0141), measured with VoiceOver and Narrator before Stage 2
  ends.
* Bad, because the updater's move from a Tauri bundle to the new shape is one-way; it is rehearsed
  on the beta line first.
* Neutral: CEF is BSD-3-licensed, which is compatible with Apache-2.0; `brand/` does not change.

## More Information

Epic #32 is the long form (Decision, Options, Architecture, §1–§13, the staged plan); this page is
the decision. The PoC: #33, #34, #35 and `spikes/compositor/README.md` (PR #62). Supersedes ADR 0001;
amends ADR 0012, ADR 0040 and ADR 0048. The surface protocol is ADR 0141, the live budget ADR 0142,
the shell ADR 0143, app-level e2e ADR 0144. `docs/ko/desk-structure.md` ("기술 스택 장단점", "결정")
and `docs/architecture.md` describe the stages.
