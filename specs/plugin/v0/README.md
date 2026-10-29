# Desk plugin v0

`plugin.schema.json` is the `plugin.json` manifest every plugin folder carries, built-in and community
plugins alike. `permission.schema.json` is the permission vocabulary: plugin manifests declare these
permissions, and every bridge call carries the one that covers it. `contributes.schema.json` is what a
plugin adds to the desk's policies as data (ADR 0017).

## Manifest

| Field | Meaning |
| --- | --- |
| `id` | Reverse-domain id with a dot, lowercase: `endue.eris`, `example.hello-ui` |
| `version` | Semantic version |
| `kind` | `ui` (sandboxed iframe), `logic` (Wasm), `tool` (MCP inside the VM), `policy` (data only) |
| `entry` | Entry file relative to the plugin folder, never outside it; a `policy` plugin has none |
| `permissions` | Everything the plugin may ask for; each is granted by the person at first use |
| `surfaces` | Surfaces a UI plugin can open, with a placement (`hidden` until it shows itself); other kinds declare none |
| `contributes` | Commands, keys, display rules, file openers, themes, settings and profiles; required for `policy` |

## Contributions

Every enabled plugin may contribute; a `policy` plugin does nothing else. The runtime layers them in this
order, each layer over the one before: the built-in `desk.*` policy plugins, the other plugins in
`plugin.list` order, `init.yaml` settings, the active profile, then changes made while Desk runs.

| Section | Like (Emacs) | A later layer |
| --- | --- | --- |
| `commands` | `defun` + `interactive` | adds commands; ids start with the plugin id |
| `keys` | `global-map` | rebinds a key; `"command": ""` unbinds it |
| `display` | `display-buffer-alist` | is asked first; the first matching rule decides |
| `files` | `auto-mode-alist` | is asked first; the first matching pattern decides |
| `themes` | `load-theme`, `defface` | adds themes; the one for the scheme and contrast in force applies |
| `settings` | `defcustom` | declares its own keys (they start with the plugin id) with defaults |
| `profiles` | `init.el` | adds profiles; a profile with the same id replaces the earlier one |

## Permission vocabulary

| Permission | Scope | Covers |
| --- | --- | --- |
| `fs:read` | `paths` | `fs.read`, `fs.list`, `fs.watch` |
| `fs:write` | `paths` | `fs.write` |
| `proc:spawn` | `commands`, `pty` | `proc.spawn`, `proc.write`, `proc.resize`, `proc.kill` |
| `net:fetch` | `hosts` | `net.fetch` |
| `audio:capture` | `wakeWord` | `audio.capture.start`, `audio.capture.stop`, `audio.wake` events |
| `ui:surface` | none | `ui.surface.open`, `ui.surface.close` |
| `ui:notify` | none | `ui.notify` |
| `plugin:manage` | none | `plugin.list`, `plugin.setEnabled`, `plugin.changed` events |
| `brain:converse` | none | `brain.say`, `brain.turn` events for the caller's own turns |
| `cmd:invoke` | `ids` | `cmd.invoke`, `cmd.list` of the commands the ids cover |
| `cmd:advise` | none | Hooks on other callers' commands; reserved, no v0 method uses it |
| `settings:read` | `keys` | `settings.get` and `settings.list` of other callers' keys, their `settings.changed` events |
| `log:read` | none | `log.tail`, `log.entry` events |
| `events:subscribe` | `names` | `events.subscribe` to the named events about every caller |
| `perm:manage` | none | `perm.list`, `perm.answer`, `perm.revoke` of any grant, `perm.prompt` events |

Paths are absolute or rooted at `~`, `${plugin}`, `${workspace}` or `${home}`, with `*` within a segment
and `**` across segments. Hosts are names with an optional port, or `*.domain` for subdomains. Commands
are program names or absolute paths, without arguments.

Command ids are lowercase and dotted (`eris.say`); in `ids`, `*` matches any run of characters, dots
included, so `*` covers every command and `eris.*` every command under `eris.`. Setting keys are
`owner/key` (`endue.eris/voice`), with `*` matching within one part: `endue.eris/*`, `*/*`. Event names
are the six that `events.subscribe` accepts: `plugin.changed`, `perm.changed`, `cmd.changed`,
`cmd.invoked`, `settings.changed` and `log.entry`.

`vectors/` holds valid and invalid manifests and permissions for the contract tests.
