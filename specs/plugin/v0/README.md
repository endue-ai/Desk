# Desk plugin v0

`plugin.schema.json` is the `plugin.json` manifest every plugin folder carries, built-in and community
plugins alike. `permission.schema.json` is the permission vocabulary: plugin manifests declare these
permissions, and every bridge call carries the one that covers it. `contributes.schema.json` is what a
plugin adds to the desk's policies as data (ADR 0017). `theme.schema.json` is a theme plugin's `theme`
block (ADR 0056, ADR 0057), and `theme-index.schema.json` a theme market's index (ADR 0060).

## Manifest

| Field | Meaning |
| --- | --- |
| `id` | Reverse-domain id with a dot, lowercase: `endue.eris`, `example.hello-ui` |
| `version` | Semantic version |
| `kind` | `ui` (sandboxed iframe), `logic` (Wasm), `tool` (MCP inside the VM), `policy` (data only), `library` (files other plugins import), `connector` (items in, actions as commands; Wasm or MCP), `view` (data only), `theme` (a theme's values and files) |
| `entry` | Entry file relative to the plugin folder, never outside it; `policy`, `library`, `view` and `theme` plugins have none |
| `permissions` | Everything the plugin may ask for; each is granted by the person at first use; a `library` has none |
| `surfaces` | Surfaces a UI plugin can open, with a placement (`hidden` until it shows itself); other kinds declare none |
| `contributes` | Commands, keys, display rules, file openers, themes, settings, profiles and palette providers; required for `policy`, refused for `library` |
| `autoload` | Off until the desk needs it, like Emacs's autoload: off at start unless a stored flag says on, its file openers count while off; `desk.files` turns it on for a file and off after its last file; default `false`; refused for `library` |
| `provides` | The roles the plugin can fill (ADR 0104): `role:rail`, `role:agents`, `role:dock`, `role:palette`, `role:settings-ui`; the `desk.roles` setting chooses each role's provider, and a provider not chosen for a role it declares does not mount |
| `view`, `views` | A `view` plugin's one view inline (`specs/view/v0`), or its view files (`.yaml`, `.yml`, `.json`); exactly one of the two. A `pack` may carry them too |
| `pack` | A `pack` plugin's pack block (`pack.schema.json`, ADR 0108): `services` it is named by, the `plugins` it brings (nested under `plugins/` in its folder, or on the desk), the commands Apply `opens`, the `profile` it lays out; required for that kind, refused for others |
| `connector` | A `connector` plugin's connector block (`specs/connector/v0`); required for that kind, refused for others |
| `theme` | A `theme` plugin's theme block (`theme.schema.json`); required for that kind, refused for others |

## Libraries

A `library` plugin is files other plugins import: code shared by several plugins lives once, and
updates like any plugin. It runs nothing of its own, so it has no `entry`, no surfaces, no
contributions, no permissions and no `autoload`: its modules run in the frame of the plugin that
imports them, under that plugin's grants. The desk installs it like any plugin and serves its files at
`/<id>/<path>` on the plugin scheme; the runtime never mounts it, `plugin.setEnabled` refuses to turn
it off (`unsupported`) and init.yaml's `plugins.disabled` does not hold it off, so `plugin.list`
always reports it enabled. A consumer maps a bare prefix to the library's folder in its page's import
map, for `endue.formats`: `{ "imports": { "@endue-ai/formats/": "/endue.formats/lib/" } }`, then
imports `@endue-ai/formats/<folder>/<file>.js`. Inside a library, modules import each other by
relative paths.

## Themes

A `theme` plugin is a theme's values and the font and image files they name: no code, so no `entry`,
contributions, permissions, surfaces or `autoload`. Its `theme` block has the layers every scheme
shares (`type`: font stacks, `scale`, `tracking`, `fonts`; `shape`: `radius` and `density` presets;
`motion`: a `personality`) and a `light` and/or `dark` variant (`colors`: token name to value, the
shell's and Eris's tokens too; `contrast`: its high-contrast changes; `material`: `opacity`, `blur`,
`noise`, `border`, `shadow`; `backdrop`: `color`, `gradient`, `angle`, `image`, `fit`, `glow`;
`terminal`: sixteen `ansi` colours). Every layer has a default and a missing scheme falls back to the
desk's own theme, so a palette alone is a theme. Numbers are bounded and presets are names, so any
valid theme stays usable. Assets are `.woff2` fonts and `.png`, `.jpg` or `.webp` images (no SVG,
which can carry script) inside the folder, at most 2 MiB each and 8 MiB together; `desk plugin
validate` checks them. The desk installs a theme like a library: always on, never mounted, served at
`/<id>/<path>`; `desk.theme.active` picks the one in force, and installing one does not apply it.
`contributes.themes` stays what it was: token sets of policy plugins that always layer underneath.

A theme market is an index (`ThemeIndex`: `format: "desk-theme-index/1"` and `themes`) and the
`.desk-theme` bundles it lists. Each entry has what a gallery card shows (`id` inside `market.`, `name`,
`version`, `description`, `author`, `license`, `tags`, up to five `preview` colours) and the bundle's
`url` (https, or a path relative to the index without `..`), `sha256` and `size` (16 MiB at most).
`desk.theme.markets` lists the indexes the desk reads, the first market that lists an id winning; the
first one is `market/themes/index.json` in this repository, where publishing is a pull request that
`scripts/theme-market.mjs` checks.

## Contributions

Every enabled plugin may contribute; a `policy` plugin does nothing else. The runtime layers them in this
order, each layer over the one before: the built-in `desk.*` policy plugins, the other plugins in
`plugin.list` order, `init.yaml` settings, the active profile, then changes made while Desk runs.

| Section | Like (Emacs) | A later layer |
| --- | --- | --- |
| `commands` | `defun` + `interactive` | adds commands; ids start with the plugin id |
| `commands[].runs` | `defalias` | makes the command an alias the desk answers: it runs `runs.command` with `runs.args`, the caller's args merged over them key by key |
| `commands[].irreversible` | `disabled-command-function` | marks a command that cannot be taken back: an agent's call of it waits for the person's approval every time, a person's never (ADR 0078) |
| `commands[].undo` | `undo` | names the command, also the plugin's, that undoes this one: each `ok` answer lands on the desk's undo stack, and `cmd.undo` runs the inverse with `{ args, result }` (ADR 0077) |
| `commands[].description`, `args`, `result` | docstring, `interactive` spec | say what the command does, a JSON Schema of its args (the core checks every `cmd.invoke` against it) and one of its answer; `cmd.list` shows them |
| `commands[].agent`, `readOnly` | none | offer the command to agents as a tool (`cmd.tools`, the desk's brain turns; it needs a description), and say it only reads; never `readOnly` with `irreversible` (ADR 0088) |
| `keys` | `global-map` | rebinds a key; `"command": ""` unbinds it |
| `display` | `display-buffer-alist` | is asked first; the first matching rule decides |
| `files` | `auto-mode-alist` | is asked first; the first matching pattern decides |
| `themes` | `load-theme`, `defface` | adds themes; the one for the scheme and contrast in force applies |
| `settings` | `defcustom` | declares its own keys (they start with the plugin id) with a `kind` and a default, optionally `choices`, `minimum`, `maximum` and `pattern`; `renamed` lists the setting's earlier full names. The core checks every value against them and a value that fails falls back to the layer below (ADR 0080) |
| `profiles` | `init.el` | adds profiles; a profile with the same id replaces the earlier one |
| `paletteProviders` | `consult-buffer-sources` | adds a group after the earlier layers' groups; commands start with the plugin id |

An alias (`runs`) is how a data-only plugin (`view`, `policy`) offers a command: the desk registers it
while the plugin is on and runs its target as `desk`; a UI plugin's command with `runs` is the desk's
too. A palette provider `{ command, title }` is asked on every change of a typed query of two characters
or more: the palette runs its command with a `PaletteQuery` (`query`, `limit`) and lists the
`PaletteResults` it answers under `title`, after the commands. Each `PaletteResult` has an `id`, a
`title`, an optional `detail` and `kind` (a short lowercase word: an item kind for items), and one to
eight `actions` (`{ command, title, args? }`): Enter runs the first, Mod+Enter the second.

## Permission vocabulary

| Permission | Scope | Covers |
| --- | --- | --- |
| `fs:read` | `paths` | `fs.read`, `fs.list`, `fs.watch` |
| `fs:write` | `paths` | `fs.write` |
| `proc:spawn` | `commands`, `pty` | `proc.spawn`, `proc.write`, `proc.resize`, `proc.kill` |
| `net:fetch` | `hosts` | `net.fetch` |
| `net:connect` | `hosts` | `net.connect`, `net.send`, `net.close` and their `net.data` and `net.closed` events; a host with a port covers that port only, one without every port |
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
| `data:read` | `kinds`, `sources` | Items of the index through `data.*` (served from #103 on); absent `kinds` or `sources` mean all |
| `connector:manage` | none | Connector instances through `connector.*`: list, connect, disconnect, pause, sync (from #103 on) |
| `view:manage` | none | The person's views through `view.*`: list, open, save, remove (from #103 on) |
| `shell:open` | `schemes`, `paths` | `shell.open` of URLs whose scheme is in `schemes` (`http`, `https`, `mailto`), and of reveals of files under `paths`; at least one of the two |
| `studio:manage` | none | The person's endue AI agents and spaces through `studio.*` (`studio.agents.*`, `studio.catalog.*`, `studio.conversations.list`, `studio.spaces.*`), under the desk's endue ID (ADR 0122, ADR 0129) |
| `computer:see` | `apps` (optional) | Screenshots, displays, windows, running apps, accessibility trees and the OS permissions through `computer.*` (ADR 0123); `apps` limits it to those bundle ids' windows and trees |
| `computer:control` | `apps` (optional) | Mouse and keyboard input, accessibility actions, launching, activating and quitting apps and the stop through `computer.*`; `apps` limits it to input to those apps. An agent's every act waits for approval (ADR 0078) |

Paths are absolute or rooted at `~`, `${plugin}`, `${workspace}` or `${home}`, with `*` within a segment
and `**` across segments. `shell:open` schemes are the three the core ever opens: a scope narrows them,
never widens them, and its `paths` are only shown in the file manager, never opened. Hosts are names with an optional port, or `*.domain` for subdomains. Commands
are program names or absolute paths, without arguments.

Command ids are lowercase and dotted (`eris.say`); in `ids`, `*` matches any run of characters, dots
included, so `*` covers every command and `eris.*` every command under `eris.`. Setting keys are
`owner/key` (`endue.eris/voice`), with `*` matching within one part: `endue.eris/*`, `*/*`. Event names
are the six that `events.subscribe` accepts: `plugin.changed`, `perm.changed`, `cmd.changed`,
`cmd.invoked`, `settings.changed` and `log.entry`. Item kinds are the nine of `specs/item/v0`; sources
are connector plugin ids, with `*` matching like command ids (`endue.*`). There is no `data:write`:
changes go through the connectors' commands (ADR 0032).

`vectors/` holds valid and invalid manifests and permissions for the contract tests.
