# Native plugins

`native.schema.json`. A native plugin (`kind: native`, `specs/plugin/v0`) is a program the desk starts
as a process of its own (ADR 0154). It speaks this protocol for its surface over one connection, and
the bridge (`specs/bridge/v0`) over another, on the wire of `desk.sock` (ADR 0030). The desk made both
connections for that process, so whatever arrives on them is that plugin's: nothing it sends names a
caller.

## Start

The desk starts the program its manifest names for this OS and processor (`native.binaries`), in the
plugin's folder, with `native.args`, when the plugin's surface is created or woken; one process
serves the plugin. Its standard input is empty, its output and errors go to the desk's. The
environment names its connections:

| Variable | Holds |
| --- | --- |
| `DESK_PLUGIN_ID` | The plugin's id |
| `DESK_SURFACE_FD` | Unix: the file descriptor of the surface connection, a stream socket the process inherited |
| `DESK_BRIDGE_FD` | Unix: the file descriptor of the bridge connection, likewise |
| `DESK_SURFACE_MACH_SERVICE` | macOS: the bootstrap name of the desk's port for the process's Mach send rights |

Windows has no transport yet: the desk reports the surface `died` with `launch-failed` there until
#61 gives it one (named pipes; a `d3d11` handle is a value in the plugin's process, which the desk
duplicates with the process handle it holds).

## The surface connection

| Way | Messages |
| --- | --- |
| desk → plugin | every `CompositorMessage`: `create` and `wake` first, then `resize`, `show`, `hide`, `pace`, `release`, input and `focus.enter`, `sleep`, `destroy`; and `desk.message` |
| plugin → desk | every `SurfaceMessage` but `died`: `attach`, `ready`, `title`, `rate`, `cursor`, `focus.leave`, IME, drags, accessibility; and `plugin.message` |

- **Lines.** One JSON text per `\n`-terminated UTF-8 line, at most 1 MiB. A line that is not a message
  of its direction is dropped, and so is a message about a surface the desk did not create on that
  connection.
- **macOS: Mach send rights.** A line that names rights (`portIndex`) follows Mach messages to the
  desk's port, sent just before it, one per right in index order, each with the right as a port
  descriptor and its IOSurfaceID inline. Reading the line, the desk takes those messages, checks that
  their sender is the process it started (the kernel's audit token) and that each right's IOSurface
  has the `id` the line names, and imports it. A texture's right comes with the first `attach` of its
  `id` and `generation`; later frames of it leave `portIndex` out. An `id` the process never sent a
  right for is refused: a plugin cannot name another process's surface.
- **Linux: file descriptors** travel with `SCM_RIGHTS` in the `sendmsg` that writes the line's first
  byte; `fdIndex` and `fenceFdIndex` count them from 0.
- **`died` is the desk's.** The process cannot say it is dead: the desk sends `died` when the process
  ends while its surface is live (`crashed` on a signal, `killed` on `SIGKILL`, `exited` with its exit
  code otherwise, `launch-failed` when it could not start).

## Page messages

A web plugin's page and the desk post each other messages (`desk:hello`, `desk:init`, `desk:ping`,
`desk:state`, ...). A native plugin has no page, so they travel on its surface connection:
`desk.message` from the desk, `plugin.message` from the plugin, each with the surface it is about.
The plugin says `desk:hello` once it listens, and the desk answers `desk:init` with `state`, what its
last `desk:state` kept, and `restored`, what it answered the desk's `ui.surface.state` command with
(`desk:command`, answered by `desk:reply`) before its surface last slept (ADR 0070). It answers every
`desk:ping` with a `desk:pong` of the same `n` from the loop that draws: a plugin that does not answer
for 5 seconds shows Not responding, as a web plugin does (#32 §9). `desk:ready` says it is up
(ADR 0061).

## Tab

A native plugin has no engine that hands the focus back at its ends, so it says so itself
(`input.md`, Tab through a surface): the desk sends `focus.enter` when Tab or Shift+Tab reaches the
plugin's window content, the plugin moves its own focus on Tab and Shift+Tab while it has the keys,
and past its last element or before its first it sends `focus.leave`, after which the desk's focus
goes on in its own order as it does past a web plugin's frame. A plugin that never sends it keeps the
keys until a click or Control+Tab moves them.

## The bridge connection

The wire of `desk.sock` (ADR 0030): a `BridgeRequest` per line in, its `BridgeResponse` and the events
for the plugin out. The caller is the plugin the desk started, and `socket.agent` is refused. Each call
needs a permission the manifest declares, which the person grants at first use as for every plugin.
The plugin hears the events addressed to it and those of its own calls (a process's output, a watch's
changes, a turn's steps).

## Stop

On `sleep` (out of the live budget, ADR 0142), on `destroy`, when the plugin is turned off and when
the desk quits, the desk sends the message, closes both connections, and kills the process if it is
still running `native.graceMs` later (2 s by default). An exit after `sleep` or `destroy` is no death;
`wake` starts the program again.
