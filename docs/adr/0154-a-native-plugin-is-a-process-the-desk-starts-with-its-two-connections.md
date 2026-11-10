---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

# A native plugin is a process the desk starts with its two connections

## Context and Problem Statement

ADR 0140 makes everything on screen a surface: a texture a process rendered, which the compositor
places. ADR 0141 makes `specs/surface/v0` the one contract between the compositor and anything that
draws, and names Stage 3's native plugins as its second implementation, beside the web host (ADR
0149). Epic #32 §6 asks for a kind `native`: a program per OS that speaks the surface protocol and the
bridge over a local socket, with rule 9 (built-ins in the community format) extended to it. A native
plugin must be as safe as the desk can make an unsandboxed program: it may call the bridge only as
itself (ADR 0012), it may show only pixels it drew, and a crash or a hang costs its window only, under
the same live budget (ADR 0142) and recovery as a web surface (#44, #39). How does the desk start one,
talk to it, know who it is, take its frames, and stop it?

## Decision Drivers

* A native plugin is identified by what the desk gave it, never by what it says
* Frames stay on the GPU across the process boundary, and a plugin cannot name another's texture
* The window manager, the live budget, the pings and the recovery the runtime already runs for web
  plugins apply unchanged: a native plugin's window is a window like any other
* Any language can write one: the wire is the specs' JSON, as `desk.sock`'s is
* macOS now; Windows and Linux compile and wait for #61's imports

## Considered Options

* The desk starts the program with two inherited socket pairs, one for the surface, one for the bridge
* The program connects to `desk.sock` and names itself, with a token the desk handed it
* One connection carrying the surface protocol and the bridge interleaved
* Global IOSurfaces named by their id, instead of Mach send rights

## Decision Outcome

Chosen option: "two inherited socket pairs", because the connection is the identity: the core serves
the bridge end as the plugin the desk started, and nothing the process sends can change that, which a
token on a shared socket cannot promise once it leaks (another process of the same user can read the
environment of the plugin on macOS). Two connections keep the bridge's wire exactly `desk.sock`'s, so
the clients that exist work, and keep a slow bridge call from delaying a frame.

* **Kind.** `plugin.json` kind `native` has a `native` block: `binaries` (the program per
  `<os>-<arch>` as Rust names them, inside the folder), `args` and `graceMs`; no `entry`; `surfaces`
  as a UI plugin's. A desk without a program for its own platform does not load the plugin
  (`desk_core::native`). The runtime mounts native plugins only where the compositor hosts them.
* **Start.** On the surface's `create` or `wake` the shell's native host (`native_host`) asks the core
  to start the program (`NativeProcess`): two `UnixStream` pairs, the child's ends inherited
  (`DESK_SURFACE_FD`, `DESK_BRIDGE_FD`), its folder as working directory, `DESK_PLUGIN_ID`. The core
  serves the bridge end with the plugin as the caller and refuses `socket.agent`; the plugin hears the
  events addressed to it and those of its own calls, nothing broadcast.
* **Surface.** `specs/surface/v0` as JSON lines (`native.md`), the desk's `CompositorMessage`s one way
  and the plugin's `SurfaceMessage`s the other, `died` excepted: the desk says it when the process ends
  while live (`crashed`, `killed`, `exited`, `launch-failed`). The page messages a web plugin and the
  runtime post each other travel as `desk.message` and `plugin.message`, so the runtime's hello, init,
  kept state and pings reach a native plugin through the same relay as a web one's (ADR 0149), and its
  windows, budget and recovery need nothing new.
* **Frames on macOS.** The plugin renders into an IOSurface of its own and sends its Mach
  send right to a port the desk checked in for that process under a bootstrap name
  (`DESK_SURFACE_MACH_SERVICE`), one Mach message per right just before the `attach` that names it
  (`portIndex`). The desk keeps the right only if the kernel's audit token says the process it started
  sent it and the IOSurface has the id the line names; a later frame may name only an IOSurface the
  process sent. The compositor then imports it as it imports a web surface's (`Frames::attach`). A
  global IOSurface, named by its id alone, would work across processes too (macOS 26 still looks
  them up), but any process could read it, and an id the desk looked up could be one of the desk's own
  surfaces: a plugin could show another window's pixels as its own.
* **Stop.** On `sleep`, `destroy`, the plugin turned off and the desk quitting, the desk sends the
  message, closes both connections and kills the process `graceMs` (2 s) later if it still runs; that
  end is no death. A hot reload (the plugin's files changed) stops the process and starts the new
  program at the window's size.
* **Windows and Linux.** They compile: the core's process start says Unsupported on Windows (no socket
  pair yet), and the native host refuses frames that are not an IOSurface, so the window shows that the
  plugin could not draw. #61 checks: named pipes and `DuplicateHandle` of a D3D11 shared handle on
  Windows; `SCM_RIGHTS` fds and the DMA-BUF import on Linux; the example's renderer on both.

### Consequences

* Good, because a native plugin's identity is the connection the desk made, and its pixels are only
  the IOSurfaces its own process sent: neither can be claimed.
* Good, because its window moves, snaps, sleeps, says Not responding and recovers through the code
  web plugins use; the only new code is the process and the transport.
* Good, because any language that writes JSON lines and reads two file descriptors can be a native
  plugin; `desk-surface`'s `native` feature does it in Rust.
* Bad, because a native plugin is not sandboxed: it runs as the person, and only its bridge calls are
  checked. The market may require a review flag for native plugins (a later ADR).
* Bad, because every native plugin that renders with Metal pays the driver's fixed cost of a process
  (~390 MiB, ADR 0142), and sleeping is an exit and a restart, not a paused renderer.
* Bad, because on macOS the rights travel on a second channel beside the socket, which a plugin must
  send in order; a right that does not come within a second costs that frame.
* Bad, because Windows and Linux only compile until #61.

## More Information

Issue #59 (epic #32 §1, §2, §6). Builds on ADR 0012 (the caller is who the desk knows), ADR 0140,
ADR 0141 (`specs/surface/v0/native.md`), ADR 0142 (the live budget), ADR 0149 (the relay and the
stand-in frames), ADR 0151 and ADR 0153 (the window manager). Code: `crates/desk-core/src/native/**`,
`crates/desk-surface/src/native/**`, `apps/desk/shell/src/native_host/**`,
`examples/plugin-native-wgpu`. Tests: `crates/desk-core/tests/native_plugin.rs`,
`examples/plugin-native-wgpu/tests/desk.rs`, `e2e/specs/native-plugin.spec.ts`. No section of
`docs/ko/desk-structure.md` changes.
