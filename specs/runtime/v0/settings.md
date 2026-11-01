# Core settings and key bindings

Settings and keyboard bindings are runtime core facilities (ADR 0031), available with no
plugins installed or enabled. No new bridge method or generated wire type is needed.

- `desk.settings.open` opens a single system settings window; optional `section` selects
  `general`, `appearance`, `keyboard`, `notifications` or `accessibility`. `Mod+,` opens it.
- `desk.settings.keyboard` (`Mod+/`) opens keyboard shortcuts. `desk.keys.quit` and `desk.keys.list`
  remain core commands. `desk.shell.open-keys` is a compatibility alias.
- Binding precedence is core defaults, enabled plugin contributions, then the person's
  `desk.keys.bindings`. Unavailable commands pass through. Recording never runs a command.
  Escape cancels recording; conflicts require an explicit replacement. Text entry and IME
  composition must not trigger unmodified global shortcuts.
- Settings use grouped rows, a searchable category sidebar and one detail panel, following
  macOS System Settings. Escape and the close control dismiss it and restore focus.
- Appearance, accessibility, do not disturb and personal bindings use existing layered
  settings. Core defaults are present even without their former policy plugins.
- Personal core settings persist as `{ version: 1, values: { ... } }` at the caller `desk`'s
  `store` key `preferences`. Loading precedes plugin/session restoration. An absent record
  migrates `session.parts.keys` once; a present empty record never resurrects old bindings.
  Invalid records/values are ignored and storage failures are shown, not reported as saved.
- Plugins may contribute keys and commands; they do not own or disable the settings UI,
  core bindings, or preference persistence. `desk.keys` is no longer shipped as a plugin.
