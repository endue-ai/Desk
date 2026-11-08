# Core settings and key bindings

Settings and keyboard bindings are runtime core facilities (ADR 0055), available with no
plugins installed or enabled. No new bridge method or generated wire type is needed.

- `desk.settings.open` opens a single system settings window; optional `section` selects
  `general`, `appearance`, `keyboard`, `notifications`, `accessibility`, `connections`, `market`
  or `plugins`. `Mod+,` opens it.
- `desk.settings.keyboard` (`Mod+/`) opens keyboard shortcuts. `desk.keys.quit` and `desk.keys.list`
  remain core commands. `desk.shell.open-keys` is a compatibility alias.
- Binding precedence is the person's `desk.keys.bindings` over enabled plugin contributions over
  core defaults; within a layer the later binding of a key wins. Unavailable commands pass
  through. Recording never runs a command. Escape cancels recording; conflicts require an
  explicit replacement. Text entry and IME composition must not trigger unmodified global
  shortcuts.
- A key is a sequence of chords (ADR 0118, `KeySequence` in
  `specs/plugin/v0/contributes.schema.json`): `Mod+K Mod+S`, `Ctrl+X Ctrl+F`, `Ctrl+C p f`. A
  single chord means what it always meant. While a prefix is pending the desk waits for the next
  chord: the which-key overlay lists every continuation (keys left, command title, owner; search,
  arrows, Enter, Backspace one chord back) and takes the focus, so plain keys after a prefix reach
  the desk from a plugin frame too, then gives it back before the command runs; the status area
  shows the keys pressed so far. Escape and `Ctrl+G` cancel; an unbound continuation is said and
  consumed.
- `desk.keys.sequence-timeout` (integer, milliseconds, 0–10000, default `0`) is how long a prefix
  waits; `0` waits as long as it takes, as Emacs does. Settings › Keyboard sets it.
- Conflicts are resolved and reported, never dropped silently: two commands on one sequence (the
  higher precedence wins), prefix shadowing in either direction (the higher precedence wins; the
  other key only waits, or can no longer be reached), and chords the system or the desk keeps
  (`Mod+Q`, `Mod+Tab` on macOS, `Alt+F4` elsewhere, the global `Mod+Shift+Space`): those stay
  bound and are reported; a cancel key after a prefix is never bound. Each conflict names where
  the binding is written: `~/.desk/keys.yaml:<line>`, a manifest's `contributes.keys[<n>]`, or
  the core default. Settings › Keyboard lists them, and `desk.keys.conflicts` answers
  `{ conflicts, lines }` (lines as `<where>: <severity>: <sentence>`, for `desk settings lint`).
- Recording reads a key as Emacs does: a chord that is a prefix of keys in force waits for the
  next, any other ends the key at once. "Record several keys in a row" takes chords until Enter.
  The first chord needs Meta, Control or Alt, or is a function key; Backspace takes one back.
  Before binding, the rebinder refuses a key that can never run and
  asks when the key would replace one or shadow others, listing them; once confirmed, the
  shadowed keys are taken away in the person's layer.
- Settings use grouped rows, a searchable category sidebar and one detail panel, following
  macOS System Settings. Escape and the close control dismiss it and restore focus.
- Appearance, accessibility, do not disturb and personal bindings use existing layered
  settings. Core defaults are present even without their former policy plugins.
- Plugins is generated from every enabled plugin's `contributes.settings`, one group per plugin:
  a boolean is a checkbox, a string with `choices` a select, an integer or number a number field
  within `minimum` and `maximum`, any other string a text field checked against `pattern`. Each row
  shows a title made from the key after the plugin's id (`week-start` reads "Week start"), the
  description and the full key; `array` and `object` settings are left to init.yaml, and keys the
  core declares stay in their own panels. A value its declaration refuses is marked and not set.
  A row's Reset forgets the person's value, so the profile, init.yaml or the default shows
  through. The search finds a row by plugin name, key, title and description. General generates
  the same rows for core settings that no hand-written row shows.
- General's "Open init.yaml" shows init.yaml (init.get's `file`, else `~/.desk/init.yaml`) in the
  file manager through `shell.open` with `reveal: true`.
- Personal core settings persist as `{ version: 1, values: { ... } }` at the caller `desk`'s
  `store` key `preferences`. Loading precedes plugin/session restoration. Invalid records/values
  are ignored and storage failures are shown, not reported as saved. A plugin's setting the person
  sets in the window joins the same record under its full name (`endue.calendar.view`) and is in
  force in the runtime's settings at once; other session values of plugin keys are not kept.
- Personal bindings (`desk.keys.bindings`) are not in that record: the runtime's `desk.keys`
  keeps them in `~/.desk/keys.yaml` (ADR 0079, `specs/init/v0/keys.schema.json`) and moves
  `session.parts.keys` there once.
- Plugins may contribute keys and commands; they do not own or disable the settings UI,
  core bindings, or preference persistence. `desk.keys` is no longer shipped as a plugin.
