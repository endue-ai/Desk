---
status: accepted
date: 2026-10-30
decision-makers: Team endue
---

# The CLI reaches a running desk over a same-user local socket, as the caller `cli`

## Context and Problem Statement

AI agents and scripts need the running desk's commands, plugins and grants without a webview
(PKG-02: the `desk` CLI, the hands AI and scripts use; PKG-03: local IPC between the running desk and
the CLI, same user only, the bridge envelope unchanged, permissions as the CLI caller). Today `desk`
has one offline subcommand, `plugin validate`, and the only way into the core is the webview's
`bridge_call`. What transport does the CLI use, what does it say on it, and what may it do?

## Decision Drivers

* Only the person's own OS account may connect; another local user must not (threat model)
* The bridge stays the one contract: no second envelope, no change to `specs/bridge/v0`
* Every call passes the permission engine, under a caller of its own
* No new network endpoint, no token to store or leak, no async runtime or `unsafe` code
* The desk never blocks on a client that stops reading

## Considered Options

* A Unix socket in the data folder, mode 0600, newline-delimited bridge JSON
* TCP on `127.0.0.1` with a token file next to it
* HTTP from a Tauri plugin (localhost server)
* D-Bus on Linux, XPC on macOS

## Decision Outcome

Chosen option: "a Unix socket in the data folder", because the file mode is the access check: the
kernel refuses `connect` to a socket file the caller cannot write (Linux and macOS), so mode 0600 lets
only the owner in, with no token, no port and nothing on the network. TCP and HTTP open a port any
local process can reach and move the check into a token file that is mode 0600 anyway; D-Bus and XPC
are two transports for one feature and neither exists on Windows.

The socket is `desk.sock` in the data folder Tauri's `app_data_dir()` names (`ai.endue.desk` under
`dirs::data_dir()`), or `DESK_SOCKET` on both sides. `crates/desk-ipc` binds it, sets 0600 before the
first `accept`, replaces a socket file nothing answers on (a crashed desk) and refuses with
`AddrInUse` when another desk answers; the app then logs one line and runs on without a socket.

The envelope is the bridge's own: one compact JSON document per `\n`-terminated line, no handshake,
version line or wrapper. A request line is a `BridgeRequest`; an answer line its `BridgeResponse`; an
event line a `BridgeEvent`, and a reader tells them apart by `id` versus `event`. A line that is not
a `BridgeRequest` is answered `invalid_params` with its `id`, or `0` when none can be read, and the
connection stays open; empty lines are ignored; clients count ids from 1. Every core event goes to
every connection, as it goes to the webview. Each connection has a reader, a writer and a 1000-line
queue; a client that lets the queue fill is dropped.

Every connection is the caller `cli`. At start the app grants `cli`, session-long, `cmd:invoke ["*"]`,
`plugin:manage`, `perm:manage` and `log:read`, and nothing else. The argument: whoever can open the
socket is the person's own account, which the threat model does not count as an attacker because it
can already do everything Desk can (run the app, edit `init.yaml`, read the data folder). These four
are what that person does through the desk's own UI: run any command, turn plugins on and off, see and
revoke grants, read the log. Sandboxed plugins cannot reach the socket: UI frames have no sockets,
Wasm instances an empty WASI, and the VM must never mount the data folder.

### Consequences

* Good, because agents and scripts get commands, plugins and grants with one std-only crate, and the
  permission engine sees each call as `cli`, so `perm list` shows and `perm revoke` removes its grants.
* Good, because the wire is the bridge: what the CLI sends is what a plugin sends, and `--json` prints
  the desk's lines unchanged.
* Bad, because the check is the file mode only; there is no peer-credential check (it needs libc and
  `unsafe`, which the workspace denies). Between `bind` and the mode change the socket has the umask's
  mode for an instant.
* Bad, because every `cli` connection shares one caller: CLI processes share grants and see each
  other's `cmd.answered` (each matches its own `invocationId`), and events are not filtered per caller.
* Bad, because Windows has no socket yet: `Listener::bind` and `Client::connect` answer `Unsupported`
  (`the desk socket is not available on Windows yet`). A named pipe with an owner DACL needs
  `windows-sys` and `unsafe`; it is its own task.

## More Information

Issue #80; `crates/desk-ipc/README.md`, `crates/desk-cli/README.md`. Requirements PKG-02 and PKG-03 in
`docs/ko/desk-requirements.md`. Threat model: `docs/security/threat-model.md` ("Another local user").
Follow-ups: the Windows named pipe (its own issue), narrower CLI grants, `log tail` once `log.tail` is
served. The crate tree in `docs/ko/desk-structure.md`, PKG-02/03 "현재" in
`docs/ko/desk-requirements.md` and `docs/qa/TESTING.md` get their lines in a later docs task.
