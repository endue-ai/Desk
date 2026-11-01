# Desk bridge v0

The calls the web runtime (and every plugin through it) makes into the Rust core. JSON Schema 2020-12,
one file per namespace: `bridge.schema.json` (envelope, errors, shared types), `fs`, `proc`, `net`, `plugins`,
`store`, `search`, `init`, `brain`, `audio`, `ui`, `perm`, `cmd`, `settings`, `log` and `events`. v0 may break on any
minor release (ADR 0004).

## Envelope

A request is `{ id, method, params }`; its response is `{ id, ok: true, result }` or
`{ id, ok: false, error }`; unprompted messages are `{ event, data }`. `result` has the shape of the
method's `*Result` definition.

## Deny by default

Every call that reaches beyond the caller's own data carries its permission scope in `params.scope`, using
the vocabulary in `specs/plugin/v0/permission.schema.json`. The core runs a call only when the caller holds
a grant that covers the scope and the scope covers the call (the path, command, host, command id, setting
or event). Otherwise the answer is `permission_denied`, with the missing permission in `error.permission`.
Scopes are never widened implicitly: asking is `perm.request`, and the person decides.

Calls that touch only the caller's own data need no scope: `perm.request`, `perm.query`, `perm.revoke` of
its own grants, `store.*`, `search.replace`, `init.get`, `cmd.register`, `cmd.unregister`, `cmd.answer`, `settings.set`,
`settings.get` and `settings.list` of its own keys, `log.write` and `events.unsubscribe`.

## Search

`search.replace` atomically publishes the installed caller's documents (500 / 4 MiB), persisted in
the core. `search.query` needs `search:read`; disabled plugins' documents are excluded. `search.system`
needs `search:system` and queries the OS index. `search.open` uses the same permission and accepts only
a recent OS result id belonging to that caller (five-minute expiry), never a supplied path.

## Callers and events

Every call is made by a caller: a plugin under its plugin id, the web runtime as `desk`. The core keeps
grants, store values, commands, settings and log channels per caller; `core` names desk-core itself.

An event about the caller's own work reaches it without asking: `fs.changed` for its watches, `proc.*` for
its processes, `audio.wake` for its captures, `brain.turn` for its turns, `perm.changed` for its grants,
`cmd.invoked` for the commands it provides, `cmd.answered` for the commands it invoked and
`settings.changed` for its own keys. `plugin.changed` goes to holders of `plugin:manage`, `perm.prompt` to
holders of `perm:manage` and `ui.notified` to the runtime, which shows it. Everything else about other
callers arrives only through `events.subscribe`.

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
`duration` says how long the grant should last: `once` (the next call it allows, then it expires),
`session` (until Desk quits, the default) or `always` (kept on disk across restarts). The person may
choose another duration, and the grant carries the one they chose. A refusal is `granted: false`, not an
error. It needs no scope.

**perm.query** lists the caller's grants, optionally only those covering a given permission.

**perm.list** lists every caller's grants with the caller that holds each, optionally for one caller, for
the person's permissions view. It needs `perm:manage`.

**perm.answer** is the prompter's half of `perm.request`. Callers that hold `perm:manage` receive a
`perm.prompt` event for each request (who asks, for what, why and for how long) and show it to the person;
the first `perm.answer` for a `promptId` decides, with `granted` and optionally the `duration` the person
chose. Answering a prompt that is already decided or withdrawn is `not_found`. Without such a caller the
core's own prompt decides.

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
`perm.changed`. With a `perm:manage` scope it revokes another caller's grant, for the person's
permissions view.

**cmd.register** adds one of the caller's commands to the registry, or updates it: an id, a title, an
optional description, keywords the palette matches, a JSON Schema for its arguments and a `when` context
expression that the runtime evaluates to offer it (palette, keys). The caller becomes the provider. Ids
are unique: an id another caller provides is `already_exists`. Commands end when their provider unloads
or its plugin is turned off. It needs no scope. The desk's own commands are registered here too, by the
runtime as `desk`, and the commands a manifest declares (`contributes.commands`) by the runtime for that
plugin when it mounts (ADR 0017).

**cmd.unregister** removes one of the caller's commands; an id it does not provide is `not_found`.

**cmd.list** returns the registered commands the `cmd:invoke` scope covers, with their providers, in
registration order. `cmd.changed` events (registered, updated, unregistered) go to subscribers.

**cmd.invoke** runs a command, whoever provides it, under a `cmd:invoke` scope whose ids cover it. `args`
must match the command's argument schema (`invalid_params` otherwise). It returns an `invocationId` at
once; the provider receives `cmd.invoked` with the id, the args and the caller, which the core records,
runs the command and answers with `cmd.answer`; the caller hears the answer as `cmd.answered`. Clicks,
keys, the palette, Eris, agents and the CLI all invoke the same way.

**cmd.answer** answers one invocation of a command the caller provides: a `result` (any JSON value) or an
`error` (`failed`, or `cancelled` when the person or the provider gave up), not both. An invocation is
answered once; another caller's is `not_found`. A provider that stops leaves its waiting invocations
answered `cancelled`. It needs no scope.

**settings.get** reads one setting. Keys belong to the caller that sets them, like the store; `owner`
names another caller, which needs a `settings:read` scope covering `owner/key`. `value` is absent for a
key that was never set.

**settings.set** writes one of the caller's own settings (64 KiB of JSON at most). Values survive
restarts, and `settings.changed` tells the owner and subscribers whose `settings:read` grant covers it.

**settings.list** returns the caller's own settings, or with a `settings:read` scope every setting it
covers, whoever owns it, each with its owner.

**log.write** adds an entry (level, message and structured `fields`) to the caller's own channel. The core
stamps the time. It needs no scope.

**log.tail** returns the latest entries, oldest first: of one channel, or of every channel merged in time
order. `count` is 100 by default and 1000 at most. It needs `log:read`.

**events.subscribe** starts delivering named events about every caller, not only the caller's own:
`plugin.changed`, `perm.changed`, `cmd.changed`, `cmd.invoked`, `settings.changed` and `log.entry`. The
`events:subscribe` scope must cover every name, and data permissions still apply: `settings.changed` only
for keys a `settings:read` grant covers, `log.entry` only with `log:read`. It returns a `subscriptionId`;
a caller gets each event once however many subscriptions name it. Subscriptions end when the caller
unloads or the grant is revoked.

**events.unsubscribe** ends one of the caller's subscriptions; an unknown id is `not_found`.

## Vectors

`vectors/valid` and `vectors/invalid` hold `{ target, description, instance }` files. Rust
(`crates/desk-bridge/tests/contract.rs`) and TypeScript (`packages/bridge/src/contract.test.ts`) must
judge each one as its folder says.
