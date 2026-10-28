# Desk bridge v0

The calls the web runtime (and every plugin through it) makes into the Rust core. JSON Schema 2020-12,
one file per namespace: `bridge.schema.json` (envelope, errors, shared types), `fs`, `proc`, `net`, `plugins`,
`store`, `init`, `brain`, `audio`, `ui` and `perm`. v0 may break on any minor release (ADR 0004).

## Envelope

A request is `{ id, method, params }`; its response is `{ id, ok: true, result }` or
`{ id, ok: false, error }`; unprompted messages are `{ event, data }`. `result` has the shape of the
method's `*Result` definition.

## Deny by default

Every call except `perm.*` carries its permission scope in `params.scope`, using the vocabulary in
`specs/plugin/v0/permission.schema.json`. The core runs a call only when the caller holds a grant that
covers the scope and the scope covers the call (the path, command or host). Otherwise the answer is
`permission_denied`, with the missing permission in `error.permission`. Scopes are never widened
implicitly: asking is `perm.request`, and the person decides.

## Methods

**fs.read** reads a whole file and returns its content as UTF-8 text or base64. The path must be inside
an `fs:read` scope. Missing files are `not_found`; folders are `invalid_params`.

**fs.write** creates or overwrites a file with the given content and returns the bytes written. It needs
an `fs:write` scope; with `createDirs` it also creates missing parent folders inside the same scope.

**fs.list** returns the entries of one folder with their kind and, for files, their size. It is not
recursive. It needs an `fs:read` scope.

**fs.watch** starts reporting changes under a path as `fs.changed` events, recursively when asked, and
returns a `watchId`. Watches end when the caller unloads or its grant is revoked. It needs `fs:read`.

**proc.spawn** starts a program with arguments (no shell), an optional working folder and extra
environment, and returns a `procId`. With `pty` it runs in a pseudo-terminal of that size and the scope
must allow `pty`. Output arrives as `proc.output` events and the end as `proc.exit`.

**proc.write** writes data to the process's stdin, or to its PTY. It needs the same `proc:spawn` scope
the process was started with.

**proc.resize** changes the PTY size of a process started with `pty`; other processes answer
`unsupported`.

**proc.kill** sends a portable signal (`term` by default; `kill`, `int`, `hup`). The process still
reports `proc.exit` when it ends.

**net.fetch** makes one HTTP or HTTPS request to a host inside a `net:fetch` scope, follows no redirects
to hosts outside it, and returns status, headers and the whole body. Non-2xx statuses are results, not
errors; a missed `timeoutMs` is `timeout`.

**audio.capture.start** opens the microphone under an `audio:capture` scope and returns a `captureId`.
With `wakeWord` (allowed by the scope) the core listens for the wake word and sends `audio.wake` events;
audio itself never leaves the core through the bridge in v0.

**audio.capture.stop** closes a capture. Stopping a capture that already ended is not an error.

**ui.surface.open** opens one of the surfaces the caller's manifest declares, optionally at a placement
and with a title, and returns a handle. It needs `ui:surface`.

**ui.surface.close** closes a surface the caller opened.

**ui.notify** shows a notification with a title, an optional body and a level, and returns its id. It
needs `ui:notify`. The core sends the runtime a `ui.notified` event naming the caller; how long it
stays, whether do-not-disturb holds it back and how much history is kept is the runtime's notify policy.

**perm.request** asks the person for a permission, showing the reason, and resolves when they answer.
A refusal is `granted: false`, not an error. It needs no scope.

**perm.query** lists the caller's grants, optionally only those covering a given permission.

**plugin.list** returns every installed plugin with its status (`ready` or `failed` with a reason), whether
it is enabled and built in, its file revision and its manifest. It needs `plugin:manage`.

**plugin.setEnabled** turns a plugin on or off and remembers the choice; the runtime mounts or unmounts
its surfaces when `plugin.changed` arrives. It needs `plugin:manage`. `plugin.changed` events (installed,
updated, removed, enabled, disabled) go to callers that hold `plugin:manage`.

**store.get** reads a value the caller stored earlier; `value` is absent for a key that was never
set. Every caller (the runtime and each plugin) has its own namespace in desk-core storage, so the
store needs no scope.

**store.set** writes one JSON value (64 KiB at most) under a key in the caller's namespace. Values
survive restarts.

**init.get** returns the setup in force from init.yaml: the profile to start in, and the settings whose
key starts with the caller's id and a dot (`desk.` for the runtime itself). When the file is not in
force, `problem` says why. Like the store, it needs no scope: callers see only their own settings.

**brain.say** sends what the person typed to the brain in the desk's session and returns a local
`turnId` at once. The answer arrives as `brain.turn` events with that id: `started`, `delta` (more text),
`completed`. When the brain is unreachable the turn waits: `offline` carries the sentence to show, the
core keeps retrying, and `online` marks the reconnection before the answer continues. `error` ends a
turn that failed, for example on a desk that became read-only because another desk took the
session's lease. It needs `brain:converse`; each turn's events go only to the caller that said it.

**perm.revoke** gives a grant back. People can revoke any grant at any time; callers learn about it from
`perm.changed`.

## Vectors

`vectors/valid` and `vectors/invalid` hold `{ target, description, instance }` files. Rust
(`crates/desk-bridge/tests/contract.rs`) and TypeScript (`packages/bridge/src/contract.test.ts`) must
judge each one as its folder says.
