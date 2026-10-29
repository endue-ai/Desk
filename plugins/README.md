# plugins

endue's built-in features, written as plugins in exactly the same folder format as community plugins. If
there were two formats, the API would have holes.

| Plugin | Role |
| --- | --- |
| `eris/` | The secretary (assets are under the `brand/` licence) |
| `sidebar/` | Left bar: agents and spaces |
| `toolbar/` | Right status panel: the drawer list (plugins, access) |
| `dock/` | Bottom dock: open and put away the plugins that open on the desk |
| `onboarding/` | First-run scenario |

The desk's default policies (ADR 0017), each a `desk.*` plugin. All but the palette are `policy` plugins:
no code, only what they contribute in `plugin.json`. Turn one off and another plugin can take its place.

| Plugin | Like (Emacs) | Decides |
| --- | --- | --- |
| `display/` (`desk.display`) | `window.el`, `display-buffer-alist` | Where a new surface goes, how big, whether it takes the focus |
| `keys/` (`desk.keys`) | `bindings.el`, `global-map` | Which key runs which command; Mod is Command on macOS, Control elsewhere |
| `palette/` (`desk.palette`) | `M-x`, the minibuffer | The command palette, picking one of many, run history, cancel (a UI plugin) |
| `buffers/` (`desk.buffers`) | `buffer.el`, `ibuffer` | The buffer list, switching, asking before closing unsaved work, what shows next |
| `files/` (`desk.files`) | `files.el`, `auto-mode-alist` | Which plugin opens a file, recent files, saving, changes on disk |
| `session/` (`desk.session`) | `desktop.el`, `savehist` | Putting the layout, open files, focus and history back at start |
| `notify/` (`desk.notify`) | the echo area, `*Messages*` | How long notifications stay by level, do not disturb, history |
| `theme/` (`desk.theme`) | `load-theme`, `defface` | Light or dark, following the OS, high contrast, reduced motion |
| `profiles/` (`desk.profiles`) | `init.el` | Profiles: a plugin set plus settings, switched and saved (formerly `modes/`) |

Every plugin folder holds `plugin.json`, `README.md`, and as needed `ui/`, `logic/`, `tool/` and `tests/`.

Status: `sidebar`, `eris`, `onboarding`, `toolbar`, `dock` and the nine `desk.*` policies work. The
runtime puts `left`, `right` and `bottom` surfaces on the desk's edges, as `desk.display` says. The first
run still draws its own frame of the toolbar, dock, profiles and left bar inside its overlay.
`just dev` installs every folder here that has a `plugin.json` as a built-in plugin.
