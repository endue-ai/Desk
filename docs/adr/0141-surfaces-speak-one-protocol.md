---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

# Surfaces speak one protocol

## Context and Problem Statement

Under ADR 0140 the compositor places textures that other processes render: an off-screen CEF browser
for every web plugin and system surface from Stage 2, and native plugins from Stage 3. Each of them
has to tell the compositor when it has a frame and how big it is, and has to receive pointer, keys,
IME, focus and drops in its own coordinates; the OS has to see one accessibility tree. If the
compositor talked to CEF's callbacks directly, it would know one engine, and native plugins would
need a second contract later. What does a surface promise the compositor, and the compositor a
surface?

## Decision Drivers

* One contract for anything that draws: CEF surfaces now, native plugins later, as Wayland gives
  every client one protocol
* Spec first and language-neutral (AGENTS.md rule 2), so a native plugin in any language can speak it
* Frames stay on the GPU on every OS: no copy through the CPU
* Input, IME and accessibility as good as a native window's
* The compositor never runs plugin code and never waits on a surface to draw its own frame

## Considered Options

* A spec of its own, `specs/surface/v0`, that the compositor and every kind of surface implement
* The compositor drives CEF directly; native plugins get a protocol of their own in Stage 3
* Wayland itself (`wl_surface`, `linux-dmabuf`, `text-input`) as the protocol on every OS

## Decision Outcome

Chosen option: "`specs/surface/v0`", because it is one contract the compositor can test against
vectors, it carries each OS's native texture handle, and a CEF browser and a native process are two
implementations of it. Wayland's protocols name Linux buffers only and would have to be extended for
IOSurface and D3D11 handles anyway.

* **Lifecycle**: `create(size, scale, format)` → `attach(texture handle)` per frame or on change →
  `resize` → `hide` / `show` → `sleep` (the process may exit; its state is kept) → `wake` →
  `destroy`.
* **Texture handle**: an IOSurface id on macOS, a D3D11 shared handle with a DXGI keyed mutex on
  Windows, a DMA-BUF fd with its modifier on Linux, delivered with a fence or acquire/release rules.
  The compositor imports each buffer once and samples it every frame; the PoC's import, a new texture
  and a blocking wait per paint, gives way to one persistent texture per surface and a fence.
* **Input**: pointer moves, buttons and wheel in surface-local coordinates, after the compositor's
  hit test and inverse transform; keys to the focused surface; IME composition and commit, with the
  caret rectangle sent back for the OS candidate window; focus in and out; cursor changes back to the
  compositor; drag enter, over, leave and drop through the broker of ADR 0119, moved to Rust.
* **Frame pacing**: a surface pushes a frame when it has damage, and the compositor redraws only when
  a surface or its own chrome changed. A hidden surface is told so and stops painting.
* **Accessibility**: each surface exports its accessibility tree (CEF's `CefAccessibilityHandler` for
  web surfaces) and the compositor feeds AccessKit, so the OS sees one tree for the desk.
* The spec lives in `specs/surface/v0` with vectors in `vectors/`, as every spec does; `just codegen`
  writes the Rust and TypeScript types, and `crates/desk-surface` holds the Rust side.
* The bridge is not part of it. A surface's bridge calls keep the bridge's wire shapes: over CEF
  process messages for web surfaces, over `desk.sock` for native ones.
* Native plugins (Stage 3, kind `native`) are processes that speak this protocol and the bridge over
  a local socket; rule 9 (built-ins in the community format) extends to them.

### Consequences

* Good, because the compositor knows surfaces, not CEF: a native plugin, or another engine, is one
  more implementation of the same contract.
* Good, because frames never leave the GPU, and input and IME arrive in each surface's own
  coordinates.
* Good, because screen readers see one tree for the whole desk.
* Bad, because three texture-sharing paths each need their own synchronisation (keyed mutexes on
  Windows; DMA-BUF modifiers, NVIDIA drivers and X11 on Linux); they are the design's only per-OS
  part.
* Bad, because accessibility parity with what WKWebView gave for free has to be built, and measured
  with VoiceOver and Narrator before Stage 2 ends.
* Bad, because the protocol starts at v0 and may break between minor versions until native plugins
  ship (ADR 0004).

## More Information

Epic #32 §2 (the protocol) and §6 (plugin kinds); issue #49 writes the spec, #52 the web surfaces,
#56 input, #57 accessibility, #59 native plugins. ADR 0140 is the direction; ADR 0142 says which
surfaces stay awake. PoC findings 2 and 3 in `spikes/compositor/README.md` (import, hidden surfaces).
