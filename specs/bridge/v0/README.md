# Desk bridge v0

The calls the web runtime (and every plugin through it) makes into the Rust core. JSON Schema 2020-12,
one file per namespace: `bridge.schema.json` (envelope, errors, shared types), `fs`, `proc`, `net`, `plugins`,
`store`, `search`, `init`, `brain`, `audio`, `ui`, `perm`, `cmd`, `settings`, `log`, `events`, `data`, `connector`,
`view`, `catalog`, `shell`, `update`, `theme`, `account` and `agent`. Items, views and connectors are the types of `specs/item`,
`specs/view` and `specs/connector` (ADR 0032). v0 may break on any minor release (ADR 0004).

## Envelope

A request is `{ id, method, params }`; its response is `{ id, ok: true, result }` or
`{ id, ok: false, error }`; unprompted messages are `{ event, data }`. `result` has the shape of the
method's `*Result` definition.

## Deny by default

Every call that reaches beyond the caller's own data carries its permission scope in `params.scope`, using
the vocabulary in `specs/plugin/v0/permission.schema.json`. The core runs a call only when the caller holds
a grant that covers the scope and the scope covers the call (the path, command, host, command id, setting
or event). Otherwise the answer is `permission_denied`, with the missing permission in `error.permission`.
Scopes are never widened implicitly: asking is `perm.request`, and the person decides. `shell.open` is the
one call that asks by itself: without a grant that covers its scope, the core asks the person for that
scope, through `perm.prompt` as `perm.request` does, and runs the call once they allow it.

Calls that touch only the caller's own data need no scope: `perm.request`, `perm.query`, `perm.revoke` of
its own grants, `store.*`, `search.replace`, `init.get`, `cmd.register`, `cmd.unregister`, `cmd.answer`, `settings.set`,
`settings.get` and `settings.list` of its own keys, `log.write`, `events.unsubscribe` and
`data.unsubscribe`. `catalog.get` needs none either: it shows only what the caller's grants already cover;
nor does `cmd.tools`, which shows an agent what its allowlist could let it run and anyone else what its
grants cover.

## Search

`search.replace` atomically publishes the installed caller's documents (500 / 4 MiB), persisted in
the core. `search.query` needs `search:read`; disabled plugins' documents are excluded. `search.system`
needs `search:system` and queries the OS index. `search.open` uses the same permission and accepts only
a recent OS result id belonging to that caller (five-minute expiry), never a supplied path.

## Callers and events

Every call is made by a caller: a plugin under its plugin id, the web runtime as `desk`, an agent of the
brain whose tool call the core runs as `agent:<id>` (ADR 0072). The core keeps grants, store values,
commands, settings and log channels per caller; `core` names desk-core itself.

An agent is never granted anything outside `agents.<id>.allow` in init.yaml when that list holds
anything: a call or `perm.request` outside it is refused at once (`perm.request` answers
`reason: "outside-allowlist"`, any other call `permission_denied`), whatever the agent holds, and the
runtime hears a `ui.notified` from `core` naming the agent. Inside it, or with an empty list, an agent's
call without a grant asks the person for the call's scope, as `shell.open` does.

An agent's irreversible call waits for the person's approval even when a grant covers it (ADR 0078):
`fs.write` to a path, and `net.fetch` to a host, that no `always` grant of the agent allows;
`proc.spawn`; and `cmd.invoke` of a command whose provider's manifest marks it `irreversible`. The core
holds the call after the cap and the permission check and sends `perm.approval` (see **perm.approve**).
A caller that is not an agent is never held.

An event about the caller's own work reaches it without asking: `fs.changed` for its watches, `proc.*` for
its processes, `audio.wake` for its captures, `brain.turn` for its turns, `perm.changed` for its grants,
`cmd.invoked` for the commands it provides, `cmd.answered` for the commands it invoked, `cmd.undone` for
the undos and redos it ran, and
`settings.changed` for its own keys and `data.changed` for its data subscriptions. `plugin.changed` goes to
holders of `plugin:manage`, `perm.prompt`, `perm.approval` and `perm.approval.done` to holders of `perm:manage`, `connector.changed` to holders of
`connector:manage`, `view.changed` to holders of `view:manage`, `update.changed` to holders of
`update:manage`, `account.changed` to holders of `account:manage`, and `ui.notified`, `ui.surface.opened` and `ui.surface.closed` to the runtime, which
shows the notification or mounts and unmounts the surface.
Everything else about other callers arrives only through `events.subscribe`.

## Methods

**fs.read** reads a whole file, or with `offset` and `length` (bytes) a range of it, and returns the
content as UTF-8 text or base64 with the file's total `size`. A range that runs past the end returns the
bytes that are there, none from an offset at or past the end; `length: 0` returns only the size. Bytes
that are not UTF-8, a whole file's or a range's, are read with `encoding: base64`; asked as UTF-8 they are
`invalid_params`. The path must be inside an `fs:read` scope. Missing files are `not_found`; folders are
`invalid_params`.

**fs.url** returns a URL the caller's frame can load one file from, so media never passes through the
bridge: `url` is `/_desk/file/<token>/<file name>`, a path the frame resolves against its own
`desk-plugin` location, with the file's `size` and the media `type` it is served with (from the
extension; `application/octet-stream` when unknown). The token is 128 random bits and belongs to the
caller; each call makes a new one. The app serves it with HTTP ranges (`206`, `Content-Range`, `416`
outside the file) and `Cache-Control: no-store`. A URL stops working when the caller unloads, when the
core stops, and as soon as the caller no longer holds an `fs:read` grant that covers the path: the grant
is checked on every request, so a `once` grant is spent by the call itself. It needs an `fs:read` scope;
missing files are `not_found` and folders `invalid_params`.

**fs.write** creates or overwrites a file with the given content and returns the bytes written. It needs
an `fs:write` scope; with `createDirs` it also creates missing parent folders inside the same scope. The
bytes go to a temp file beside the target that is renamed over it, so the file is the old content or the
new, never a mix. Before it overwrites a file whose bytes differ, the core keeps the old ones as a version
in its local history and answers that version's id as `version` (ADR 0076); a new file keeps nothing.

**fs.history** lists the versions the core kept of one file, newest first, `limit` at most: each is the
content a write replaced, with `at` (when that write ran), `caller` (whose write it was), `size` and
`sha256`. A path the core kept nothing of answers an empty list, also when the file is gone. It needs an
`fs:read` scope. The history keeps `desk.files.history-max-versions` versions per path (50) and
`desk.files.history-max-bytes` in all (256 MiB), dropping the oldest first.

**fs.restore** writes a version back as fs.write writes it, so what it replaces is kept as a version in
turn, and answers what fs.write answers. It needs an `fs:write` scope. A version the path's history does
not hold is `not_found`; one whose bytes no longer match their `sha256` is `io_error`, and nothing is
written.

**fs.list** returns the entries of one folder with their kind, for files their size, and `modifiedAt`,
when the entry last changed (absent when the OS has none). It is not recursive. It needs an `fs:read`
scope.

**fs.watch** starts reporting changes under a path as `fs.changed` events, recursively when asked, and
returns a `watchId`. Watches end when the caller unloads or its grant is revoked. It needs `fs:read`.

**proc.spawn** starts a program with arguments (no shell), an optional working folder and extra
environment, and returns a `procId`. With `pty` it runs in a pseudo-terminal of that size and the scope
must allow `pty`. Output arrives as `proc.output` events and the end as `proc.exit`. A caller that
unloads, or loses the grant that covers the command, has its processes killed and reaped; their
`proc.exit` still arrives.

**proc.write** writes data to the process's stdin, or to its PTY. It needs the same `proc:spawn` scope
the process was started with.

**proc.resize** changes the PTY size of a process started with `pty`; other processes answer
`unsupported`.

**proc.kill** sends a portable signal (`term` by default; `kill`, `int`, `hup`). The process still
reports `proc.exit` when it ends.

**net.fetch** makes one HTTP or HTTPS request to a host inside a `net:fetch` scope, follows no redirects
to hosts outside it, and returns status, headers and the whole body. Non-2xx statuses are results, not
errors; a missed `timeoutMs` is `timeout`. A redirect outside the scope is `permission_denied` before it
is connected to. Header names come back lowercase; `bodyEncoding` is `utf8` for a body that is UTF-8 text
and `base64` otherwise. More than 10 redirects or a body over 64 MiB is `io_error`.

**audio.capture.start** opens the microphone under an `audio:capture` scope and returns a `captureId`.
With `wakeWord` (allowed by the scope) the core listens for the wake word and sends `audio.wake` events;
audio itself never leaves the core through the bridge in v0.

**audio.capture.stop** closes a capture. Stopping a capture that already ended is not an error.

**ui.surface.open** opens one of the surfaces the caller's manifest declares, optionally at a placement
and with a title, and returns a handle. It needs `ui:surface`. A surface the manifest does not declare is
`invalid_params`, and so is any call by a caller without a manifest (`desk`, `cli`). The runtime hears
`ui.surface.opened` with the handle, the caller, the surface, its placement and title (the call's, else
the manifest's) and mounts it as its display policy says. Opening a surface that is open gives another
handle.

**ui.surface.close** closes a surface the caller opened and sends the runtime `ui.surface.closed`. A
handle the caller does not hold is `not_found`. A caller that unloads has its surfaces closed, each with
its `ui.surface.closed`; losing `ui:surface` leaves them open.

**ui.surface.state** is the one request that goes the other way: the runtime sends it to a plugin's
frame, as it sends `desk.files.visit`, never to the core, and it is not a `BridgeRequest`. Before the
runtime unloads a surface that has not been visible for `desk.display.unload-after`, or the one hidden
longest once more than `desk.display.live-surfaces` frames are live (ADR 0070), it asks with the
manifest's `surface` id. A plugin may answer with `state`, any JSON up to 64 KiB as UTF-8; the runtime
keeps it in memory for the session and hands it back as `restored` in the frame's next `desk:init`,
when the surface shows again. An answer without `state`, an error, a bigger state, no answer within
two seconds or a frame that never said hello: the frame is unloaded all the same and comes back cold.
Answering is optional, and needs no permission.

**ui.notify** shows a notification with a title, an optional body and a level, and returns its id. It
needs `ui:notify`. The core sends the runtime a `ui.notified` event naming the caller; how long it
stays, whether do-not-disturb holds it back and how much history is kept is the runtime's notify policy.

**perm.request** asks the person for a permission, showing the reason when there is one, and resolves
when they answer. `duration` says how long the grant should last: `once` (the next call it allows, then it
expires), `session` (until Desk quits, the default) or `always` (kept on disk across restarts). The person
may choose another duration, and the grant carries the one they chose. A refusal is `granted: false`, not
an error. It needs no scope.

The core's prompt policy decides when the person is asked. A request that one of the caller's lasting
grants (`session` or `always`) already covers is granted at once with that grant. Identical requests
(the same caller and permission, scope included) that wait at the same time share one prompt, and the one
answer answers them all; a `once` answer gives each its own grant. A refusal the person makes is
remembered for the session for that caller and that permission: asking again answers `granted: false`
with `reason: "refused-earlier"` at once, without a prompt, until the caller is granted a permission
that covers it. `shell.open` answers such a request `permission_denied` at once.

**perm.query** lists the caller's grants, optionally only those covering a given permission.

**perm.list** lists every caller's grants with the caller that holds each, optionally for one caller, for
the person's permissions view. It needs `perm:manage`.

**perm.answer** is the prompter's half of `perm.request`. Callers that hold `perm:manage` receive a
`perm.prompt` event for each request (who asks, for what, why and for how long) and show it to the person;
the first `perm.answer` for a `promptId` decides, with `granted` and optionally the `duration` the person
chose. Answering a prompt that is already decided or withdrawn is `not_found`. Without such a caller the
core's own prompt decides, and its refusals are not remembered. When a caller asks for a third folder
(`fs:read` or `fs:write` over `<folder>/**`) under the same parent in a session, its prompt carries
`parent`, the same permission over `<parent>/**`; `parent: true` in the answer grants that instead. The
parent is never a root, the home folder or a folder holding it, nor a scope the person refused that caller
earlier; `parent: true` on a prompt without one is `invalid_params`.

**perm.approve** is the prompter's answer to `perm.approval`, the card an agent's irreversible call
waits on. The event names the agent, the `action` (`fs.write`, `proc.spawn`, `net.fetch`,
`cmd.invoke`), the scope the call carries, its `target` (the path, the command, the URL, the command
id) and a `preview`: for a write, a unified diff of the file against what the write puts there (a new
file is all additions) when both are UTF-8 text and the file is at most 1 MiB, the first 200 changed
lines, with `size`, the bytes it writes; for a spawn its command line, for a fetch the method and the
URL, for a command its args as JSON. `task` is the desk's brain turn the call belongs to, when there is
one. The first `perm.approve` decides: `once` runs this call; `task` runs it and lets the agent's later
calls of the same action through, without asking, for the rest of that turn when the approved scope
covers their target (a write's `fs:write` scope, a fetch's `net:fetch` scope, the spawn's command, the
command's id), and is `invalid_params` without a task; `deny` refuses the call `permission_denied` and is
not remembered. An approval that is already decided is `not_found`. Without a `perm:manage` holder the
core's own prompt decides, and refuses by default. Once an approved call ran, `perm.approval.done` says
whether it succeeded, with `bytesWritten` for a write and the `error` when it failed; `undoable` will
say when `cmd.undo` (#276) can take a write back.

**plugin.list** returns every installed plugin with its status (`ready` or `failed` with a reason), whether
it is enabled and built in, its file revision, its manifest and the folder it was installed from (an
absolute path, so `desk.describe` can name and reveal its plugin.json). It needs `plugin:manage`.

**plugin.setEnabled** turns a plugin on or off and remembers the choice; the runtime mounts or unmounts
its surfaces when `plugin.changed` arrives. It needs `plugin:manage`. `plugin.changed` events (installed,
updated, removed, enabled, disabled) go to callers that hold `plugin:manage`.

**plugin.stats** counts the bridge calls each caller made over the last minute (`windowSeconds`): every
call the core answered, a plugin's, the runtime's (`desk`) and the CLI's (`cli`), and how many of them
failed, most calls first. It needs `perm:manage`.

**store.get** reads a value the caller stored earlier; `value` is absent for a key that was never
set. Every caller (the runtime and each plugin) has its own namespace in desk-core storage, so the
store needs no scope.

**store.set** writes one JSON value (64 KiB at most) under a key in the caller's namespace. Values
survive restarts.

**init.get** returns the setup in force from init.yaml: the profile to start in, and the settings whose
key starts with the caller's id and a dot (`desk.` for the runtime itself). When the file is not in
force, `problem` says why. `file` says where init.yaml is, rooted at `~` inside the home folder. Like
the store, it needs no scope: callers see only their own settings.

**brain.say** sends what the person typed to the brain in the desk's session and returns a local
`turnId` at once. The answer arrives as `brain.turn` events with that id: `started`, `delta` (more text),
`completed`. When the brain is unreachable the turn waits: `offline` carries the sentence to show, the
core keeps retrying, and `online` marks the reconnection before the answer continues. `error` ends a
turn that failed, for example on a desk that became read-only because another desk took the
session's lease. It needs `brain:converse`; each turn's events go only to the caller that said it.
Eris's loop (ADR 0089): a call of one of the desk's tools that names no agent runs as `agent:eris`,
up to 12 calls a turn, and `tool` and `tool-result` (with `tool: { callId, command, provider, title,
ok }`) mark each hand-off to a command and its return.

**brain.ask** asks the brain one question and returns a local `turnId` at once; the answer is the
arguments the brain calls the caller's `tool` with (ADR 0059). `prompt` is everything the brain gets: the
desk's conversation is neither sent nor written, because each ask opens a session of its own with its
own lease, offers the tool with `toolChoice` naming it (`tools` in `specs/brain/v0`), and releases the
lease once the turn ends. The core never runs the tool and never answers the call. The turn arrives as
`brain.turn` events addressed to the caller only (`started`, `delta`, `completed`); `completed` carries
`structured`, the tool call's arguments, when the brain called the tool with arguments that match its
`schema`, and nothing when it answered in text instead (a brain that does not know tools). `schema` is
a JSON Schema 2020-12 whose `type` is `object`; it may `$ref` the desk's specs by their `$id`, and one
that does not compile is `invalid_params`. An unreachable brain gives the same `offline` turn as
`brain.say`: the ask waits, retries and continues after `online`; a refusal is `error`. It needs
`brain:ask`, which reaches no session of the desk's: `brain:converse` does not cover it, nor it
`brain:converse`. A desk without a brain answers `unsupported`.

**brain.agents.list** returns one page of the person's agents, newest first, as the brain contract's
`listAgents` answers it (`AgentList` in `specs/brain/v0`, passed through): `spaceId` keeps the agents in
that space, `status` keeps one status, and `page` (from 1) and `limit` (1 to 100) choose the page, with
the brain's defaults when left out. A query the brain refuses is `invalid_params`; a brain that cannot be
reached is `io_error`. It needs `brain:converse`, like the next four, and a desk without a brain answers
`unsupported`.

**brain.agents.card** returns one agent's A2A card (`AgentCard`) by `agentId`. An agent the brain does
not know is `not_found`.

**brain.spaces.list** returns every space the person can open (`SpaceList`), in the brain's order.

**brain.tasks.list** returns one page of the A2A tasks agents handed each other, newest first
(`A2ATaskList`): `targetAgentId` keeps the tasks one agent is doing, `status` keeps one status, and
`page` and `limit` work as for agents.

**brain.status** says which brain the desk talks to: `local` with the model it runs, `cloud` with the
credits left when the brain reports them, or `offline` while the brain cannot be reached. The core asks
the brain on every call; a desk without a brain is `offline`.

**perm.revoke** gives a grant back. People can revoke any grant at any time; callers learn about it from
`perm.changed`. With a `perm:manage` scope it revokes another caller's grant, for the person's
permissions view.

**cmd.register** adds one of the caller's commands to the registry, or updates it: an id, a title, an
optional description, keywords the palette matches, a JSON Schema for its arguments and a `when` context
expression that the runtime evaluates to offer it (palette, keys). The caller becomes the provider. Ids
are unique: an id another caller provides is `already_exists`. Commands end when their provider unloads
or its plugin is turned off. It needs no scope. The desk's own commands are registered here too, by the
runtime as `desk`, and the commands a manifest declares (`contributes.commands`) by the runtime for that
plugin when it mounts (ADR 0017). `undo` names the command that undoes this one (the caller provides it
too); without it, the `undo` the caller's manifest gives the id, if any. `cmd.list` shows it. So do
`description`, `argsSchema`, `resultSchema`, `agent` and `readOnly` (ADR 0088): each the call's, else what
the caller's manifest declares for the id (`description`, `args`, `result`, `agent`, `readOnly`), and
`irreversible`, which only the manifest says. A command marked `agent` without a description, or
`readOnly` while the manifest marks it irreversible, is `invalid_params`.

**cmd.unregister** removes one of the caller's commands; an id it does not provide is `not_found`.

**cmd.list** returns the registered commands the `cmd:invoke` scope covers, with their providers, in
registration order. `cmd.changed` events (registered, updated, unregistered) go to subscribers.

**cmd.tools** lists the registered commands marked `agent`, the tools agents are offered (ADR 0088), in
registration order: each with its tool `name` (the id with every dot an underscore, absent past 64
characters), title, description, args and result schemas, `readOnly`, `irreversible`, provider, and
`granted`, whether a grant of the caller covers it now. An agent sees every one its allowlist could let it
run (all of them with an empty allowlist); any other caller those its `cmd:invoke` grants cover. Every
word of `query` must appear, ignoring case, in the id, title, description or keywords; `limit` is 50 when
absent, 200 at most. It needs no scope and spends no grant.

**cmd.invoke** runs a command, whoever provides it, under a `cmd:invoke` scope whose ids cover it. `args`
must match the command's argument schema (`invalid_params` otherwise). It returns an `invocationId` at
once; the provider receives `cmd.invoked` with the id, the args and the caller, which the core records,
runs the command and answers with `cmd.answer`; the caller hears the answer as `cmd.answered`. Clicks,
keys, the palette, Eris, agents and the CLI all invoke the same way.

**cmd.answer** answers one invocation of a command the caller provides: a `result` (any JSON value) or an
`error` (`failed`, or `cancelled` when the person or the provider gave up), not both. An invocation is
answered once; another caller's is `not_found`. A provider that stops leaves its waiting invocations
answered `cancelled`. It needs no scope.

**cmd.recent** returns the last 200 invocations the core saw, whoever invoked them, oldest first: the
command, the caller, the provider, when it was invoked on the core's clock and, once answered, how long it
took in milliseconds and whether it ended with a result or which error. One still waiting has neither. It
needs `perm:manage`, like the grants an inspector shows beside it.

**cmd.undo** undoes the newest entry of the desk's undo stack, one stack for the desk whoever pushed it
(ADR 0077). An entry is pushed when a command that names an `undo` is answered `ok` (`{ command, args,
result, caller, at, inverse }`), and when `fs.write` or `fs.restore` keeps a version (`inverse` is
`fs.restore`, `result` is `{ version }`); a new entry clears what `cmd.redo` could redo, and the stack
keeps 200. The scope must cover the entry's inverse (`permission_denied` otherwise, and the stack stays as
it was). For a command, the core invokes the inverse with `{ args, result }` and answers its
`invocationId` (its answer reaches the caller as `cmd.answered`); for a write, it restores the version
before answering. `undone` is the entry, absent when the stack is empty. `cmd.undone { entry, by, redo }`
goes to the caller and to subscribers. An inverse run by cmd.undo pushes nothing.

**cmd.redo** runs the entry cmd.undo undid last again: the command with its args, answered as cmd.undo
answers (a write: the core puts back what the undo replaced). The scope must cover the entry's command
(`fs.restore` for a write). Its answer pushes the entry again without clearing what is left to redo.

**settings.get** reads one setting. Keys belong to the caller that sets them, like the store; `owner`
names another caller, which needs a `settings:read` scope covering `owner/key`. `value` is absent for a
key that was never set. The value in force is the set value, else init.yaml's, else the default the
owner declares (ADR 0031), each checked against the declaration (`kind`, `choices`, `minimum`,
`maximum`, `pattern`): a value that fails is skipped, so the layer below shows through. A layer with no
value under the setting's name gives the one it holds under an earlier name from `renamed`, and
`migratedFrom` names it (ADR 0080).

**settings.set** writes one of the caller's own settings (64 KiB of JSON at most). Values survive
restarts, and `settings.changed` tells the owner and subscribers whose `settings:read` grant covers it.
A value that fails the caller's declaration of the key is refused with `invalid_value`.

**settings.list** returns the caller's own settings, or with a `settings:read` scope every setting it
covers, whoever owns it, each with its owner and, read under an earlier name, `migratedFrom`.

**settings.invalid** names a value that fell back: owner, key, value, `reason`, and the `file` and
`line` it is written on (init.yaml, a saved profile, a plugin.json; a set value has neither). The core
logs each one once per run on its `core` channel and sends the event to the owner and to `desk`; each
`init.get` from `desk` sends desk every one still in force, so a runtime that starts after the core
hears them all. It is not an `events.subscribe` name. A name under a plugin that declares settings but
not this one is a logged warning naming the nearest declared name; a name under any other owner is kept.

**log.write** adds an entry (level, message and structured `fields`) to the caller's own channel. The core
stamps the time. It needs no scope.

**log.tail** returns the latest entries, oldest first: of one channel, or of every channel merged in time
order. `count` is 100 by default and 1000 at most. It needs `log:read`. The core writes the channel
`perm`: every grant (`decision: granted`), every refusal (`refused`) and every call of an agent
(`allowed` or `denied`), with `caller`, `permission`, `scope`, and `target` (the path, command or other
target), `reason`, `duration` and `grantId` where they apply. An agent's irreversible call the person
approved is `approved`, with `approval` (`once` or `task`), `approvalId` and `task`; one they denied is
`refused` with `reason: not-approved`.

**events.subscribe** starts delivering named events about every caller, not only the caller's own:
`plugin.changed`, `perm.changed`, `cmd.changed`, `cmd.invoked`, `settings.changed` and `log.entry`. The
`events:subscribe` scope must cover every name, and data permissions still apply: `settings.changed` only
for keys a `settings:read` grant covers, `log.entry` only with `log:read`. It returns a `subscriptionId`;
a caller gets each event once however many subscriptions name it. Subscriptions end when the caller
unloads or the grant is revoked.

**events.unsubscribe** ends one of the caller's subscriptions; an unknown id is `not_found`.

**data.query** returns one page of the index's items that the query matches: its `kinds`, `sources` (a
connector id or `connector/instance`; a view's `$name` is `invalid_params`), full-text `text` and `where`
conditions, in `sort` order (newest `updatedAt` first when absent), `limit` at a time (50, at most 500).
The page's `cursor` asks for the next one; a cursor the core did not hand out is `invalid_params`. It needs
a `data:read` scope, and items of kinds or sources the scope does not cover are left out, not refused.

**data.get** returns one item by its source and id, or no `item` when the index has none or the
`data:read` scope does not cover it.

**data.subscribe** starts delivering `data.changed` events for the items a query selects (its kinds,
sources, text and where conditions; sort, cursor and limit do not apply) and the `data:read` scope
covers, and returns a `subscriptionId`. Each event carries the changes in order; an item that stops
matching arrives as `removed`. Subscriptions end when the caller unloads or its grant is revoked.

**data.unsubscribe** ends one of the caller's data subscriptions; another caller's or an unknown id is
`not_found`.

**connector.list** returns the installed connectors by id, each with its instances (status, the title the
person gave it, its settings but the secret ones) and the kinds of item it brings in. It needs
`connector:manage`.

**connector.connect** adds an instance of an installed connector and returns its id, `default` when none
is given. `settings` follow the connector's `instanceSettings`: a name it does not declare, a value of the
wrong kind or a missing required one is `invalid_params`, and secret values stay with the core and never
come back out (ADR 0036). An unknown connector is `not_found`; an instance id it already has is
`already_exists`. No v0 method starts an OAuth flow.

**connector.disconnect** removes an instance and the items it brought in, which subscribers hear as
`removed`. An unknown instance is `not_found`.

**connector.sync** syncs one instance now and returns `started: true` at once; its progress arrives as
`connector.changed` (`syncing`, then `connected` or `error`). An unknown instance is `not_found`.
`connector.changed` events (`connected`, `updated`, `disconnected`, with the status after the change) go
to holders of `connector:manage`.

**view.list** returns the views by id, with their version, title, description and `source`: `file` for
the person's (`~/.desk/views`), `plugin` with the `plugin` id for an enabled view plugin's inline `view`
or `views` files, which are read-only. The person's files hold item views and universal views (`AnyView`,
ADR 0102): a universal view's line has its `type` and no `version`, and its id for a title when it has
none. Each id is listed once: the person's file shadows a plugin's view
of its id, then the plugins count in `plugin.list` order. It needs `view:manage`.

**view.get** returns one view whole, with the same `source` and `plugin`; an unknown id is `not_found`.

**view.save** writes one of the person's views, new or replacing the one with its id. An item view must
pass `specs/view/v0` and its names must resolve (`desk_bridge::view_problems`: every `$name` a `requires`
entry, every param a template reads declared); a universal view (a `type` or a `source`, no `layout`)
must pass `universal.schema.json` and have its id; otherwise it is `invalid_params` and nothing is written.
An id an enabled view plugin provides is `invalid_params` too ("owned by plugin ..."), unless the
person's file of that id exists, which it then replaces.

**view.remove** deletes one of the person's views; a plugin's view is `invalid_params` naming the plugin,
and an unknown id is `not_found`. `view.changed` events (`saved`, `removed`) go to holders of
`view:manage`. They also follow the view plugins: when one is installed, turned on or off, or reloaded,
each id it now provides is `saved` and each it stopped providing `removed`, unless a person's file
shadows it; removing a person's file that shadowed a plugin's view is `saved`.

**catalog.get** describes what a view, or the brain writing one, can use here: the view components the
desk renders, the connected connectors with their instances and the kinds and fields of their items, and
the registered commands. It takes no params and needs no scope: a caller sees only the connectors and kinds
its `data:read` grants cover and the commands its `cmd:invoke` grants cover.

**shell.open** hands a link to the system and answers `opened: true` once the system took it. `target` is
an absolute URL, opened in the system's default app for its scheme: the browser for `http` and `https`,
the mail app for `mailto`. Only those three are ever opened, whatever a scope says: `file:`,
`javascript:`, `data:`, any other scheme, a URL with control characters and a relative one are
`invalid_params`. The URL goes to the OS as one argument, never through a shell (`open` on macOS,
`xdg-open` on Linux, `ShellExecuteW` on Windows). With `reveal: true`, `target` is a path (`~/...` or
absolute) and its folder is shown in the file manager with the file selected (`open -R`, the
`org.freedesktop.FileManager1` D-Bus call or `xdg-open` of the folder, `explorer /select,`); a path is
only shown, never opened or run, and a missing one is `not_found`. It needs a `shell:open` scope whose
`schemes` hold the URL's scheme, or whose `paths` cover the path; a target the scope does not cover is
`permission_denied` at once. Without a grant that covers the scope the core asks the person first (see
Deny by default): a refusal is `permission_denied`, a caller that unloads first `cancelled`.

**account.status**, **account.signIn** and **account.signOut** are the desk's endue ID (ADR 0089).
Each needs `account:manage`, which the desk grants to the runtime only, and answers `AccountStatus`.
`account.signIn` starts the device authorization grant (RFC 8628), opens the page where the code is
entered and answers `signing-in` with `signIn`; `account.changed` reports `signed-in`, or `signed-out`
with a `problem`. The core gives the token to the brain as its bearer token; it never crosses the bridge.

**agent.list**, **agent.cancel** and **agent.report** are the agent registry (ADR 0100). `agent.list`
answers every agent the desk knows as an `AgentRecord` (`specs/agent/v0`) with its state, Eris first;
`agent.cancel` stops a run by its item id (and `source` when it is not `desk.agents`): a waiting run is
denied, a running command answered `cancelled`, a reported run's reporter hears `agent.cancelled`. Both
need `perm:manage`. `agent.report` keeps a run of an agent the caller runs, under the caller's own source;
it needs no scope. Runs are items of kind `run`: the core records one for every command an agent caller
asks for and for the brain directory's tasks.

**update.status**, **update.check**, **update.download** and **update.apply** drive the desk's own
updates (ADR 0054). Each needs an `update:manage` scope, which the desk grants to the runtime and the
CLI only, and each answers the same `UpdateStatus`: the `state`, the running build (`current`), the
`channel` it follows, when the channel index was last read (`checkedAt`) and the build it chose
(`release`, with `staged` once that build is verified on disk, and `received` and `total` bytes while it
downloads). The desk reads its channel index by itself (30 s after start, then every four hours);
`update.check` reads it now, also when `desk.update.check` is off. With `desk.update.auto` on (the
default) a newer build downloads at once; otherwise the state stays `available` until
`update.download`, which is `invalid_params` when nothing is available. `update.apply` checks the staged
build's signature and sha256 again, installs it and restarts the desk; it is `invalid_params` when
nothing is staged. `check`, `download` and `apply` answer at once; progress and outcomes arrive as
`update.changed` with the whole status. A failed step leaves `state: failed` with a `reason`, and a
staged build stays staged. A build that does not update itself (no updater key, a development build, the
browser stub) answers `unsupported`.

**theme.save**, **theme.import**, **theme.export** and **theme.remove** keep the person's own themes
(ADR 0058). Each needs a `theme:manage` scope, which the desk grants to the runtime and the CLI only. A
user theme is a theme plugin (`specs/plugin/v0/theme.schema.json`) in the desk's user themes folder
(`<data>/themes/<id>/`), installed at start like any plugin but not built in, watched, and announced
with `plugin.changed`. Which theme is in force stays with `desk.theme.active`: saving or importing one
does not apply it. `theme.save` takes a manifest of kind `theme` whose id is inside `local.` and its
font and image files inline (`files`, base64); with `copyFrom` the files the manifest names that `files`
leaves out are copied from that installed theme's folder at the same paths, which is how a tuned copy
of a built-in theme keeps its fonts. The folder is written beside the others, checked as a plugin folder
(the schema, the assets and their limits), and only then put in place: when the check fails the answer
is `invalid_params` with the problems and nothing changes. A save replaces an earlier user theme of
the same id whole; an id a built-in or any other plugin holds is `already_exists`. `theme.import`
installs a `.desk-theme` bundle (`ThemeBundle`: `format: "desk-theme/1"`, the `manifest`, and
`files` by path, base64; 16 MiB at most) given inline (`bundle`), as a file (`path`), or by `url`:
`https` only, downloaded by the core with no redirect to another host and refused unless its bytes
match `sha256`. A bundle whose id is outside `local.` and `market.` lands as `local.<its name as a
slug>`; the rest is as `theme.save`. `theme.export` makes a bundle of any installed theme, built-in
ones too: with `inline: true` it is the answer, otherwise it is written to `path` or to
`<Downloads>/<id>.desk-theme` (`<id>-2.desk-theme` and on when that is taken) and the answer is the
file's absolute path. The same theme exports to the same bytes, and a bundle imported and exported
again comes back byte for byte. `theme.remove` deletes a user theme's folder (`local.` and `market.`
ids only; any other plugin is `invalid_params`, an id nothing holds `not_found`). A desk that keeps no
user themes folder (the browser stub) answers `unsupported` to `theme.save`, `theme.import` and
`theme.remove`.

**theme.market.list** and **theme.market.fetch** read the theme markets (ADR 0060), under the same
`theme:manage`. `theme.market.list` downloads every index the setting `desk.theme.markets` lists
(`specs/plugin/v0/theme-index.schema.json`), over `https` from each index's own host, and merges their
themes by id, the first market winning. Each theme comes with its entry (`url` made absolute against
its index), the `market` that listed it, the version installed if any, and a `state`: `available`,
`installed` (as the market publishes it now), `update` (installed from a market, unchanged since, and
the market has other bytes now) or `edited` (installed but changed since, or brought in from a file).
An index that cannot be read leaves its themes out and is named in `problems`. `theme.market.fetch`
downloads a bundle to preview it: `https`, refused unless it matches `sha256`, checked as a theme plugin
in a temporary folder that goes again, and answered as the bundle; nothing is installed. Installing is
`theme.import` with `url`, `sha256` and `market`: beside a `market.` theme the core keeps where it came
from (`<data>/themes/.market/<id>.json`: the market, the URL, the version, the sha256 and a hash of
the folder as it landed). A later import of the same id by `url` replaces it only while its folder still
has that hash; a theme the person changed is `already_exists` and stays. `theme.remove` forgets the
record with the folder.

## Vectors

`vectors/valid` and `vectors/invalid` hold `{ target, description, instance }` files. Rust
(`crates/desk-bridge/tests/contract.rs`) and TypeScript (`packages/bridge/src/contract.test.ts`) must
judge each one as its folder says.
