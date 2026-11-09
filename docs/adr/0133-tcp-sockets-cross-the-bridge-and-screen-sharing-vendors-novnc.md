---
status: accepted
date: 2026-11-09
decision-makers: Team endue
---

# TCP sockets cross the bridge (net.connect), and Screen Sharing vendors noVNC

## Context and Problem Statement

The person wants another Mac's screen inside the desk: macOS Screen Sharing, embedded, as a client of
its own. Screen Sharing is a VNC (RFB) server on port 5900; a client needs a raw TCP connection to it,
an RFB implementation (the handshake, Apple Remote Desktop and VNC authentication, the encodings) and
a canvas for the screen with the keyboard and the pointer sent back.

Plugin frames have no network of their own: their CSP allows `connect-src` only to the desk's own
sources (`apps/desk/src-tauri/src/plugin-csp.txt`), and every primitive passes the bridge's permission
check (ADR 0012, the deny-by-default rule of `specs/bridge`). The bridge had HTTP (`net.fetch`) and
processes (`proc.*`), but no socket. Where do the bytes go, and where does RFB run?

## Decision Drivers

* The permission model holds: a connection to a host and port is granted by the person, per computer,
  revocable, and the frame reaches nothing else
* Production RFB on the first day: Apple Remote Desktop authentication (DH, MD5, AES), the encodings a
  Mac sends, keyboard maps and the cursor are years of edge cases
* A plugin folder runs as it is (ADR 0012); the vendored code is reproducible from a pin (ADR 0037)
* A small core: a TCP primitive, not a VNC feature, in Rust

## Considered Options

* `net.connect`, `net.send`, `net.close` and `net.data` / `net.closed` events under a new `net:connect`
  permission; noVNC in the plugin over a WebSocket-like channel made of those calls
* A loopback WebSocket proxy in the app (websockify) and the plugin's CSP opened to `ws://127.0.0.1:*`
* RFB in Rust (a crate in the core) streaming decoded frames to the frame
* Spawning `nc` through `proc.spawn` and using the process's pipes as the byte channel

## Decision Outcome

Chosen option: "`net.connect` over the bridge, noVNC in the plugin", because the bytes then pass the
same permission check as everything else, the core gains one primitive any plugin can use (an SSH or a
database client next), and RFB is the plugin's concern.

* `specs/plugin/v0`: `net:connect` with `hosts` (HostPattern; with a port, that port only; without,
  every port). `specs/bridge/v0/net.schema.json`: `net.connect { host, port, timeoutMs?, scope }` →
  `{ socketId }`, `net.send { socketId, data }` (base64), `net.close { socketId }`, and the events
  `net.data` (base64, 64 KiB at most) and `net.closed` (the last, with a `reason` unless the other end
  closed it), to the socket's owner only. The runtime routes them like a process's (`owners.ts`).
* `crates/desk-core/src/core_sockets.rs`: std TCP, a timeout of 10 s by default, one reader thread per
  socket, at most 8 sockets per caller; a socket closes when its caller unloads or its grant goes.
* `plugins/screens` (`endue.screens`, Screen Sharing) asks `perm.request` for `host:port` at its first
  connection, then hands noVNC a channel (`ui/channel.js`) that sends one `net.send` at a time with what
  queued meanwhile. Passwords are asked each time and never kept.
* noVNC 1.7.0 (MPL-2.0, its pako files MIT) is pinned in `plugins/screens/package.json` and copied by
  `just vendor-novnc` (`scripts/vendor-novnc.mjs`) into `ui/vendor/novnc/` with its licences, keeping
  the package's layout so its relative imports resolve; `scripts/vendor-novnc.test.mjs` fails when the
  copy differs. MPL-2.0 is file-level: the vendored files stay as they are, the plugin's own files are
  Apache-2.0.

### Consequences

* Good, because the frame still connects to nothing itself, and the person grants each computer once.
* Good, because noVNC speaks what macOS offers (Apple Remote Desktop, type 30; VNC, type 2) and the
  encodings, cursor and keyboard maps it needs, as a community plugin could use it too.
* Bad, because every byte crosses the bridge as base64 in JSON: a third more bytes and a copy per hop.
  A busy 5K screen may lag where a native client would not; a binary channel is the next decision if it
  matters.
* Bad, because 730 KiB of third-party code is in the repository and updates are by hand.

### Rejected

* The loopback proxy: once a frame may open `ws://127.0.0.1:*`, every plugin could reach every local
  service (dev servers, Docker's API) without a grant.
* RFB in Rust: frames would still cross the bridge, as images, and the core would carry a feature.
* `nc` through `proc.spawn`: a program the person may not have (Windows), granted as "run programs".

## More Information

`plugins/screens/README.md`, `specs/bridge/v0/README.md` (net.connect), ADR 0012 (plugins run from
their folder), ADR 0037 (vendoring xterm.js, the same pattern).
